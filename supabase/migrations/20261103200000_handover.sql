-- =============================================================================
-- Kiran DMS · migration 0023 · Two-party cash handover (task P1-07)
-- Requirements: PAY-05 (the manager records the counted cash, the system computes the variance, a
--               variance needs a reason, nothing is edited afterwards), PAY-10 (append-only),
--               CTL-03 (the rep acknowledges the figure in their own app before it is final; a
--               disagreement locks the handover for owner review), PAY-04 (cash in hand decreases
--               on handover).
-- Docs: 09 section 5, 08 (custody chain: rep minus, office plus), 13 section 3 and M1, 06 section 2
--       (manager or owner counts, the rep acknowledges), 04 (handover), ACTIVITY L-0356 (MJ: B-37
--       does not hold back the handover), L-0357 (two immutable tables instead of a status column),
--       A-15 (how the ledger moves).
--
-- What is built: the office counts a rep's cash. The expected figure is the rep's ledger balance at
-- that moment, computed here, never sent by the page. The rep answers once, on their approved
-- phone: `ack` makes it final and moves the cash in the same transaction (the rep's ledger `out` of
-- the expected amount, the office's `in` of the counted amount; the variance and its reason stay on
-- the handover row); `dispute` moves nothing and leaves it for the owner. A rep with a pending or
-- disputed handover cannot be counted again. Both calls are idempotent on client_id and serialised
-- per rep.
--
-- What is not built: the owner's resolution of a dispute (not specified, A-15), doc 08's rule that
-- an open handover blocks the next day and doc 02's red banner, bank deposits (CTL-04), the
-- intraday cash cap (CTL-17), petty expenses, the variance detector D-05 and the digest.
-- =============================================================================

-- ------------------------------------------------------------------- tables ----
create table public.handover (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null unique,                                   -- idempotency key (H-08)
  rep_id           uuid not null references public.user_profile (id),
  rep_day_id       uuid references public.rep_day (id),                    -- the rep's day, when there is one
  expected_paisa   bigint not null check (expected_paisa >= 0),            -- the rep's ledger balance at the count
  counted_paisa    bigint not null check (counted_paisa >= 0),
  variance_paisa   bigint generated always as (expected_paisa - counted_paisa) stored,   -- positive: short
  variance_reason  text check (variance_reason is null or length(btrim(variance_reason)) between 5 and 300),
  counted_by       uuid not null references public.user_profile (id),
  counted_by_role  public.app_role not null check (counted_by_role in ('owner', 'manager')),
  counted_at       timestamptz not null default now(),
  constraint handover_two_parties check (counted_by <> rep_id),
  constraint handover_variance_reason check ((expected_paisa = counted_paisa) or variance_reason is not null),
  constraint handover_not_empty check (expected_paisa > 0 or counted_paisa > 0)
);
create index handover_rep_idx on public.handover (rep_id, counted_at desc);
comment on table public.handover is
  'PAY-05, CTL-03. Append-only. The office''s count of a rep''s cash; final only when the rep acknowledges in handover_response (L-0357).';

create table public.handover_response (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null unique,                                       -- idempotency key (H-08)
  handover_id  uuid not null unique references public.handover (id),     -- one answer per handover
  kind         text not null check (kind in ('ack', 'dispute')),
  note         text check (note is null or length(btrim(note)) between 5 and 300),
  responded_by uuid not null references public.user_profile (id),
  responded_at timestamptz not null default now(),
  constraint handover_dispute_note check (kind = 'ack' or note is not null)
);
comment on table public.handover_response is
  'CTL-03. Append-only. The rep''s one answer to a handover: ack (final, cash moves) or dispute (locked for the owner).';

-- ----------------------------------------------------------------- guards ------
create trigger append_only before update or delete on public.handover          for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.handover                  for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.handover_response for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.handover_response         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.handover          for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.handover_response for each row execute function control.audit_row();

-- ------------------------------------------------------------------ helpers ----
-- A rep's cash in hand, from the ledger (H-10).
create function app.rep_cash_balance(p_rep_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case e.direction when 'in' then e.amount_paisa else -e.amount_paisa end), 0)::bigint
  from public.cash_ledger_entry e
  where e.holder_type = 'rep' and e.holder_id = p_rep_id
$$;

-- -------------------------------------------------------------------- count ----
-- PAY-05: the owner or manager records the cash counted from a rep. Idempotent on client_id.
create function app.office_count_handover(
  p_client_id uuid, p_rep_id uuid, p_counted_paisa bigint, p_variance_reason text default null)
returns public.handover
language plpgsql security definer set search_path = '' as $$
declare
  v_role     public.app_role := app.assert_office();
  v_reason   text := nullif(btrim(p_variance_reason), '');
  v_expected bigint;
  h          public.handover;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a handover needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-client:' || p_client_id::text, 0));
  select * into h from public.handover x where x.client_id = p_client_id;
  if found then
    if h.rep_id is distinct from p_rep_id or h.counted_paisa is distinct from p_counted_paisa
       or h.variance_reason is distinct from v_reason then
      raise exception using errcode = '22023', message = 'this client_id was used for a different handover';
    end if;
    return h;
  end if;

  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'unknown or inactive rep';
  end if;
  if p_counted_paisa is null or p_counted_paisa < 0 then
    raise exception using errcode = '22023', message = 'the counted amount must be zero or more';
  end if;

  -- One count at a time per rep, and the same lock as the rep's answer (A-15).
  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || p_rep_id::text, 0));
  if exists (select 1 from public.handover x left join public.handover_response r on r.handover_id = x.id
             where x.rep_id = p_rep_id and (r.id is null or r.kind = 'dispute')) then
    raise exception using errcode = '55000',
      message = 'this rep has a handover waiting for an answer or under dispute; it must be settled first';
  end if;

  v_expected := app.rep_cash_balance(p_rep_id);
  if v_expected < 0 then v_expected := 0; end if;
  if v_expected = 0 and p_counted_paisa = 0 then
    raise exception using errcode = '22023', message = 'nothing to hand over: the rep holds no cash and none was counted';
  end if;
  if v_expected <> p_counted_paisa and (v_reason is null or length(v_reason) < 5) then
    raise exception using errcode = '22023',
      message = format('the count differs from the expected Rs %s; give a reason of at least 5 characters',
                       to_char(v_expected / 100.0, 'FM999,999,990.00'));
  end if;

  insert into public.handover (client_id, rep_id, rep_day_id, expected_paisa, counted_paisa, variance_reason,
                               counted_by, counted_by_role)
  values (p_client_id, p_rep_id,
          (select d.id from public.rep_day d where d.rep_id = p_rep_id and d.day = app.karachi_today()),
          v_expected, p_counted_paisa, case when v_expected = p_counted_paisa then null else v_reason end,
          auth.uid(), v_role)
  returning * into h;
  return h;
end $$;

-- ------------------------------------------------------------------- answer ----
-- CTL-03: the rep answers its own handover, once, on its approved phone. ack: final, and the cash
-- moves (A-15). dispute: a reason is required and nothing moves.
create function app.rep_respond_handover(p_client_id uuid, p_handover_id uuid, p_accept boolean, p_note text default null)
returns public.handover_response
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v_note text := nullif(btrim(p_note), '');
  v_kind text := case when p_accept then 'ack' else 'dispute' end;
  h      public.handover;
  r      public.handover_response;
begin
  if v_role <> 'rep' then perform app.raise_denied('only the rep answers its own handover'); end if;
  if p_client_id is null or p_accept is null then
    raise exception using errcode = '22023', message = 'an answer needs a client_id and ack or dispute';
  end if;
  select * into h from public.handover x where x.id = p_handover_id;
  if not found or h.rep_id <> auth.uid() then
    perform app.raise_denied('this is not your handover');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || h.rep_id::text, 0));
  select * into r from public.handover_response x where x.handover_id = h.id;
  if found then
    if r.client_id = p_client_id and r.kind = v_kind and r.note is not distinct from v_note then
      return r;
    end if;
    raise exception using errcode = '55000', message = 'this handover has already been answered';
  end if;
  if exists (select 1 from public.handover_response x where x.client_id = p_client_id) then
    raise exception using errcode = '22023', message = 'this client_id was used for a different answer';
  end if;
  if v_kind = 'dispute' and (v_note is null or length(v_note) < 5) then
    raise exception using errcode = '22023', message = 'say why you disagree (at least 5 characters)';
  end if;

  insert into public.handover_response (client_id, handover_id, kind, note, responded_by)
  values (p_client_id, h.id, v_kind, v_note, auth.uid())
  returning * into r;

  if v_kind = 'ack' then
    if h.expected_paisa > 0 then
      insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
      values ('rep', h.rep_id, 'out', h.expected_paisa, 'handover', h.id);
    end if;
    if h.counted_paisa > 0 then
      insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
      values ('office', null, 'in', h.counted_paisa, 'handover', h.id);
    end if;
  end if;
  return r;
end $$;

-- -------------------------------------------------------------------- reads -----
-- The calling rep's handovers, newest first, at most 20: what to answer, and what was decided.
create function app.my_handovers()
returns table (handover_id uuid, counted_at timestamptz, expected_paisa bigint, counted_paisa bigint,
               variance_paisa bigint, variance_reason text, counted_by_name text, status text,
               responded_at timestamptz, response_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not app.self_ok() then
    perform app.raise_denied('only a rep reads its own handovers');
  end if;
  return query
  select h.id, h.counted_at, h.expected_paisa, h.counted_paisa, h.variance_paisa, h.variance_reason, u.full_name,
         case r.kind when 'ack' then 'final' when 'dispute' then 'disputed' else 'pending' end,
         r.responded_at, r.note
  from public.handover h
  join public.user_profile u on u.id = h.counted_by
  left join public.handover_response r on r.handover_id = h.id
  where h.rep_id = auth.uid()
  order by h.counted_at desc, h.id
  limit 20;
end $$;

-- The office's list, newest first, at most 100; open ones (pending or disputed) first.
create function app.office_handovers()
returns table (handover_id uuid, rep_id uuid, rep_name text, counted_at timestamptz, expected_paisa bigint,
               counted_paisa bigint, variance_paisa bigint, variance_reason text, counted_by_name text,
               status text, responded_at timestamptz, response_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select h.id, h.rep_id, rp.full_name, h.counted_at, h.expected_paisa, h.counted_paisa, h.variance_paisa,
         h.variance_reason, cb.full_name,
         case r.kind when 'ack' then 'final' when 'dispute' then 'disputed' else 'pending' end,
         r.responded_at, r.note
  from public.handover h
  join public.user_profile rp on rp.id = h.rep_id
  join public.user_profile cb on cb.id = h.counted_by
  left join public.handover_response r on r.handover_id = h.id
  order by (r.kind is null or r.kind = 'dispute') desc, h.counted_at desc, h.id
  limit 100;
end $$;

-- Office cash = handovers in minus deposits out (doc 09 section 5); deposits are not built yet.
create function app.office_cash_position()
returns table (in_paisa bigint, out_paisa bigint, balance_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select coalesce(sum(e.amount_paisa) filter (where e.direction = 'in'), 0)::bigint,
         coalesce(sum(e.amount_paisa) filter (where e.direction = 'out'), 0)::bigint,
         coalesce(sum(case e.direction when 'in' then e.amount_paisa else -e.amount_paisa end), 0)::bigint
  from public.cash_ledger_entry e
  where e.holder_type = 'office';
end $$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.handover          enable row level security;
alter table public.handover          force  row level security;
alter table public.handover_response enable row level security;
alter table public.handover_response force  row level security;

-- The office reads all; a rep reads its own (on its approved phone), as with payments.
create policy handover_select on public.handover for select to authenticated
  using ((select app.is_office()) or (rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy handover_response_select on public.handover_response for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.handover h where h.id = handover_id and h.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.handover, public.handover_response from public, anon, authenticated, service_role;
grant select on public.handover, public.handover_response to authenticated, service_role;

revoke execute on function
  app.rep_cash_balance(uuid),
  app.office_count_handover(uuid, uuid, bigint, text),
  app.rep_respond_handover(uuid, uuid, boolean, text),
  app.my_handovers(),
  app.office_handovers(),
  app.office_cash_position()
  from public, anon, authenticated, service_role;

grant execute on function
  app.office_count_handover(uuid, uuid, bigint, text),
  app.rep_respond_handover(uuid, uuid, boolean, text),
  app.my_handovers(),
  app.office_handovers(),
  app.office_cash_position()
  to authenticated;
