-- =============================================================================
-- Kiran DMS · migration 20261105150000 · Requests queue with lines, salon portal
-- Completion slice 6 (P1-23). Requirements: ORD-01, ORD-11 to ORD-15, SAL-12, SEC-14, SEC-15; D-34,
-- D-41; B-40 (d) (L-0378); spec 2026-11-05 rulings R1, R5, R6 and sections 2 to 4 and 7.
--
-- What is built:
--   * public.order_intake_card holds rep cards and salon requests: submitter_kind ('rep' or 'salon'),
--     salon_user_id (the salon login that sent it); rep_id, rep_day_id and body become optional, and a
--     check keeps both shapes (a rep card: rep, rep day, a note; a salon request: no rep, no day, no
--     visit, the login). Existing cards are rep cards (column default).
--   * public.order_intake_card_line (append-only): the product lines of each version of a card: a SKU
--     and a quantity. There is no price column: prices are never taken from the submitter (R6). The
--     order takes the salon's own price, else the list price, in app.build_order (slice 2).
--   * public.order_intake_card_version (append-only): an edit before review is a new version (2 to 51)
--     with its note and lines; version 1 is the card itself. Nothing is overwritten.
--   * public.order_intake_card_close gains outcome 'cancelled' (by the submitter, before review) and
--     closed_by_salon_user. A card closes once (unique card_id) and every path locks the card row
--     first, so convert, reject, cancel and edit take turns and the second sees the close (55000).
--   * app.rep_create_card takes optional lines. New: app.rep_edit_card, app.rep_cancel_card,
--     app.salon_submit_request, app.salon_edit_request, app.salon_cancel_request (B-40 d: until the
--     office reviews; after that 55000).
--   * app.office_open_cards lists rep cards and salon requests with their current version, lines,
--     the database's price per line and an estimate. app.my_cards shows version, lines and cancelled.
--   * app.office_create_order gains p_card_version (a stale view is refused, 55000). With no lines it
--     takes the card's current lines (one click). A salon request becomes a salon_portal order (new
--     check: no rep, no rep day, no visit, a request). No new order_status values (R5); reps still
--     never create an official order (R1). Rejecting stays app.office_dismiss_card.
--   * Salon reads, resolved from the caller's active membership with an emailed-code session, never
--     from an id the caller sends, allow-listed fields only (no cost, margin, supplier, stock location,
--     rep, GPS or hold internals): app.salon_catalogue, app.salon_my_requests, app.salon_my_orders,
--     app.salon_my_account. A suspended or revoked membership stops at once.
-- =============================================================================

-- ------------------------------------------------------------------ cards ----
alter table public.order_intake_card
  add column submitter_kind text not null default 'rep' check (submitter_kind in ('rep', 'salon')),
  add column salon_user_id  uuid references auth.users (id);
alter table public.order_intake_card alter column rep_id drop not null;
alter table public.order_intake_card alter column rep_day_id drop not null;
alter table public.order_intake_card alter column body drop not null;
alter table public.order_intake_card add constraint order_intake_card_submitter_shape check (
  (submitter_kind = 'rep' and rep_id is not null and rep_day_id is not null and body is not null and salon_user_id is null)
  or (submitter_kind = 'salon' and rep_id is null and rep_day_id is null and visit_id is null and salon_user_id is not null));
create index order_intake_card_salon_user_idx on public.order_intake_card (salon_user_id) where salon_user_id is not null;
comment on table public.order_intake_card is
  'D-30, D-34. Append-only. A request: a rep''s card (a note, optional lines) or a salon''s request (lines, optional note). It is not an order. The office converts it (app.office_create_order) or rejects it (app.office_dismiss_card); the submitter may edit (order_intake_card_version) or cancel it before that.';
comment on column public.order_intake_card.body is
  'Version 1''s note: required on a rep card, optional on a salon request. Later versions carry their own.';

-- ------------------------------------------------------------------ closes ----
alter table public.order_intake_card_close drop constraint order_intake_card_close_outcome_check;
alter table public.order_intake_card_close drop constraint order_intake_card_close_shape;
alter table public.order_intake_card_close alter column closed_by drop not null;
alter table public.order_intake_card_close add column closed_by_salon_user uuid references auth.users (id);
alter table public.order_intake_card_close
  add constraint order_intake_card_close_outcome_check check (outcome in ('converted', 'dismissed', 'cancelled')),
  add constraint order_intake_card_close_shape check (
    (outcome = 'converted' and order_id is not null and reason is null)
    or (outcome = 'dismissed' and order_id is null and length(btrim(coalesce(reason, ''))) >= 5)
    or (outcome = 'cancelled' and order_id is null and (reason is null or length(btrim(reason)) between 1 and 500))),
  add constraint order_intake_card_close_by check (
    (outcome <> 'cancelled' and closed_by is not null and closed_by_salon_user is null)
    or (outcome = 'cancelled' and (closed_by is null) <> (closed_by_salon_user is null)));
create index order_intake_card_close_salon_user_idx on public.order_intake_card_close (closed_by_salon_user)
  where closed_by_salon_user is not null;
comment on table public.order_intake_card_close is
  'D-30, D-34. Append-only. How a request ended: converted into an order, dismissed (rejected by the office, a reason of at least 5 characters) or cancelled by its submitter before review.';

-- ------------------------------------------------------------- versions, lines ----
create table public.order_intake_card_version (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null unique,                         -- idempotency key (H-08)
  card_id              uuid not null references public.order_intake_card (id),
  version              integer not null check (version between 2 and 51),
  body                 text check (body is null or length(btrim(body)) between 1 and 2000),
  edited_by            uuid references public.user_profile (id),    -- a rep editing its card
  edited_by_salon_user uuid references auth.users (id),             -- a salon login editing its request
  created_at           timestamptz not null default now(),
  unique (card_id, version),
  constraint order_intake_card_version_editor check ((edited_by is null) <> (edited_by_salon_user is null))
);
create index order_intake_card_version_editor_idx on public.order_intake_card_version (edited_by) where edited_by is not null;
create index order_intake_card_version_salon_user_idx on public.order_intake_card_version (edited_by_salon_user)
  where edited_by_salon_user is not null;
comment on table public.order_intake_card_version is
  'D-34, B-40 (d). Append-only. An edit of an open request by its submitter: the note and (in order_intake_card_line) the lines of versions 2 to 51. Version 1 is the card row.';

create table public.order_intake_card_line (
  id      uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.order_intake_card (id),
  version integer not null check (version between 1 and 51),
  line_no integer not null check (line_no between 1 and 50),
  sku_id  uuid not null references public.sku (id),
  qty     integer not null check (qty between 1 and 10000),
  unique (card_id, version, line_no),
  unique (card_id, version, sku_id)
);
create index order_intake_card_line_sku_idx on public.order_intake_card_line (sku_id);
comment on table public.order_intake_card_line is
  'D-34, R6. Append-only. A product line of one version of a request: a SKU and a quantity, never a price.';

create trigger append_only before update or delete on public.order_intake_card_version for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.order_intake_card_line    for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card_version for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card_line    for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.order_intake_card_version for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.order_intake_card_line    for each row execute function control.audit_row();

alter table public.order_intake_card_version enable row level security;
alter table public.order_intake_card_version force  row level security;
alter table public.order_intake_card_line    enable row level security;
alter table public.order_intake_card_line    force  row level security;

-- As the card itself: the office reads all; a rep reads its own cards' versions and lines on its
-- approved phone. A salon reads none of these tables: it reads through app.salon_* only.
create policy order_intake_card_version_select on public.order_intake_card_version for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.order_intake_card c where c.id = card_id and c.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));
create policy order_intake_card_line_select on public.order_intake_card_line for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.order_intake_card c where c.id = card_id and c.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));

revoke all on public.order_intake_card_version, public.order_intake_card_line from public, anon, authenticated, service_role;
grant select on public.order_intake_card_version, public.order_intake_card_line to authenticated, service_role;

-- ------------------------------------------------------------- order channel ----
-- A salon portal order is made by the office from a salon's request: no rep, no rep day, no visit.
alter table public.sales_order add constraint sales_order_salon_portal_shape check (
  source_channel <> 'salon_portal'
  or (rep_id is null and rep_day_id is null and visit_id is null and intake_card_id is not null));
comment on column public.sales_order.source_channel is
  'D-30, D-34. Where the order came from: rep_visit (rep orders before D-30), office (made by the owner or a manager, directly or from a rep''s card), salon_portal (made by the office from a salon''s request).';

-- ------------------------------------------------------------------- helpers ----
-- Internal (no grant). The current version of a card: its latest edit, else 1.
create function app.card_version(p_card_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(v.version) from public.order_intake_card_version v where v.card_id = p_card_id), 1)
$$;

-- Internal (no grant). The note of a card's current version.
create function app.card_body(p_card_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when x.version = 1 then c.body
              else (select v.body from public.order_intake_card_version v where v.card_id = c.id and v.version = x.version) end
  from public.order_intake_card c
  cross join lateral (select app.card_version(c.id) as version) x
  where c.id = p_card_id
$$;

-- Internal (no grant). When the card's current version was made.
create function app.card_updated_at(p_card_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce((select max(v.created_at) from public.order_intake_card_version v where v.card_id = c.id), c.created_at)
  from public.order_intake_card c where c.id = p_card_id
$$;

-- Internal (no grant). The lines of one version as the order engine takes them: [{sku_id, qty}].
create function app.card_order_lines(p_card_id uuid, p_version integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', l.sku_id, 'qty', l.qty) order by l.line_no), '[]'::jsonb)
  from public.order_intake_card_line l
  where l.card_id = p_card_id and l.version = p_version
$$;

-- Internal (no grant). The lines of one version as pages show them; with p_with_price, the price the
-- order would take for this salon (its own price, else the list price), as app.build_order does.
create function app.card_lines_shown(p_card_id uuid, p_version integer, p_with_price boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('line_no', l.line_no, 'sku_id', l.sku_id, 'code', k.code, 'product_name', p.name,
                              'variant', k.variant, 'qty', l.qty)
           || case when p_with_price
                   then jsonb_build_object('price_paisa', coalesce(app.salon_price(c.salon_id, k.id), k.list_price_paisa))
                   else '{}'::jsonb end
           order by l.line_no), '[]'::jsonb)
  from public.order_intake_card_line l
  join public.order_intake_card c on c.id = l.card_id
  join public.sku k on k.id = l.sku_id
  join public.product p on p.id = k.product_id
  where l.card_id = p_card_id and l.version = p_version
$$;

-- Internal (no grant). The lines a caller sent, in a form to compare a replay with: [[sku_id, qty], ...]
-- in the order given; no lines reads []. Nothing is validated here.
create function app.card_lines_key(p_lines jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when p_lines is null then '[]'::jsonb
    when jsonb_typeof(p_lines) <> 'array' then p_lines
    else coalesce((select jsonb_agg(jsonb_build_array(lower(e.val ->> 'sku_id'), e.val -> 'qty') order by e.ord)
                   from jsonb_array_elements(p_lines) with ordinality as e(val, ord)), '[]'::jsonb) end
$$;

-- Internal (no grant). The stored lines of one version in the same form.
create function app.card_stored_key(p_card_id uuid, p_version integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(l.sku_id::text, to_jsonb(l.qty)) order by l.line_no), '[]'::jsonb)
  from public.order_intake_card_line l
  where l.card_id = p_card_id and l.version = p_version
$$;

-- Internal (no grant). Request lines: 1 to 50 objects of exactly {sku_id, qty}; any other key (a price
-- above all) is refused, because prices are the office's (R6). Each SKU active, of an active product,
-- with a list price, once; a whole quantity of 1 to 10000.
create function app.assert_card_lines(p_lines jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'a request has 1 to 50 lines';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e(val) where jsonb_typeof(e.val) <> 'object') then
    raise exception using errcode = '22023', message = 'every line is a SKU and a quantity';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e(val), jsonb_object_keys(e.val) k(name)
             where k.name not in ('sku_id', 'qty')) then
    raise exception using errcode = '22023',
      message = 'a request line has a SKU and a quantity only: prices are set by the office, never by the request';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e(val)
             where jsonb_typeof(e.val -> 'sku_id') is distinct from 'string'
                or (e.val ->> 'sku_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                or not (case when jsonb_typeof(e.val -> 'qty') = 'number' and (e.val ->> 'qty') ~ '^[0-9]{1,5}$'
                             then (e.val ->> 'qty')::integer between 1 and 10000 else false end)) then
    raise exception using errcode = '22023', message = 'every line needs a SKU and a whole quantity of 1 to 10000';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e(val)
             left join public.sku k on k.id = (e.val ->> 'sku_id')::uuid
             left join public.product p on p.id = k.product_id
             where k.id is null or not k.active or not p.active or k.list_price_paisa is null) then
    raise exception using errcode = '22023', message = 'every line needs an active, priced product from the catalogue';
  end if;
  if (select count(distinct (e.val ->> 'sku_id')::uuid) from jsonb_array_elements(p_lines) e(val)) <> jsonb_array_length(p_lines) then
    raise exception using errcode = '22023', message = 'a product appears once in a request';
  end if;
end $$;

-- Internal (no grant). Writes the (already checked) lines of one version.
create function app.insert_card_lines(p_card_id uuid, p_version integer, p_lines jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.order_intake_card_line (card_id, version, line_no, sku_id, qty)
  select p_card_id, p_version, e.ord::integer, (e.val ->> 'sku_id')::uuid, (e.val ->> 'qty')::integer
  from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
$$;

-- Internal (no grant). A note of at most 2000 characters; blank is none.
create function app.card_note(p_note text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := app.blank_to_null(p_note);
begin
  if length(v) > 2000 then
    raise exception using errcode = '22023', message = 'a note has at most 2000 characters';
  end if;
  return v;
end $$;

-- Internal (no grant). The salon of the caller's active membership, when the session proved the
-- mailbox with an emailed code (as app.salon_me); null for anyone else, a staff login included.
create function app.my_salon_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.salon_id from public.salon_membership m
  where m.user_id = auth.uid() and m.status = 'active' and app.session_proved_email()
    and not exists (select 1 from public.user_profile p where p.id = auth.uid())
$$;

-- Internal (no grant). The caller's salon, or 42501.
create function app.assert_salon_member() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := app.my_salon_id();
begin
  if v is null then perform app.raise_denied('this login has no active salon account'); end if;
  return v;
end $$;

-- ------------------------------------------------------------- rep cards ----
-- Migration 20261105100000's card, with optional lines (slice 6). The replay compares the lines too.
drop function app.rep_create_card(uuid, uuid, text, uuid);
create function app.rep_create_card(p_client_id uuid, p_salon_id uuid, p_body text, p_visit_id uuid default null,
                                    p_lines jsonb default null)
returns public.order_intake_card
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  k      public.order_intake_card;
  v_day  uuid;
  v_body text := btrim(p_body);
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps save order cards'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a card needs a client_id (idempotency key, H-08)';
  end if;
  select * into k from public.order_intake_card where client_id = p_client_id;
  if k.id is not null then
    if k.submitter_kind = 'rep' and k.rep_id = auth.uid() and k.salon_id = p_salon_id and k.body = v_body
       and k.visit_id is not distinct from p_visit_id and app.card_stored_key(k.id, 1) = app.card_lines_key(p_lines) then
      return k;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before saving order cards (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps save order cards only for salons in their own territories');
  end if;
  perform app.assert_salon_approved(p_salon_id);
  if v_body is null or length(v_body) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'an order card needs a note of 1 to 2000 characters';
  end if;
  if p_visit_id is not null and not exists (
       select 1 from public.visit v where v.id = p_visit_id and v.rep_id = auth.uid() and v.salon_id = p_salon_id
         and v.rep_day_id = v_day) then
    raise exception using errcode = '22023', message = 'the visit must be the rep''s visit to this salon today';
  end if;
  if p_lines is not null then perform app.assert_card_lines(p_lines); end if;
  perform app.set_purpose('order card saved');
  insert into public.order_intake_card (client_id, salon_id, rep_id, rep_day_id, visit_id, body)
  values (p_client_id, p_salon_id, auth.uid(), v_day, p_visit_id, v_body)
  returning * into k;
  if p_lines is not null then perform app.insert_card_lines(k.id, 1, p_lines); end if;
  return k;
end $$;

-- The rep edits its own open card: a new version with the note and lines given (lines optional). The
-- rep must still reach the salon, on its approved phone; no open day is needed (an edit is not a visit).
-- Unknown and other people's cards get the same refusal. Replay on client_id (H-08).
create function app.rep_edit_card(p_client_id uuid, p_card_id uuid, p_body text, p_lines jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  k      public.order_intake_card;
  v      public.order_intake_card_version;
  v_body text := app.blank_to_null(p_body);
  v_next integer;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps edit their order cards'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an edit needs a client_id (idempotency key, H-08)';
  end if;
  select * into v from public.order_intake_card_version x where x.client_id = p_client_id;
  if v.id is not null then
    if v.card_id = p_card_id and v.edited_by = auth.uid() and v.body is not distinct from v_body
       and app.card_stored_key(v.card_id, v.version) = app.card_lines_key(p_lines) then
      return jsonb_build_object('card_id', v.card_id, 'version', v.version);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into k from public.order_intake_card c where c.id = p_card_id for update;
  if k.id is null or k.submitter_kind <> 'rep' or k.rep_id is distinct from auth.uid() then
    perform app.raise_denied('reps edit only their own order cards');
  end if;
  if exists (select 1 from public.order_intake_card_version x where x.client_id = p_client_id) then
    raise exception using errcode = '23505', message = 'client_id already used; reload and try again';
  end if;
  if exists (select 1 from public.order_intake_card_close x where x.card_id = k.id) then
    raise exception using errcode = '55000', message = 'this order card was already reviewed or cancelled; it can no longer change';
  end if;
  if not app.rep_can_reach_salon(k.salon_id) then
    perform app.raise_denied('reps edit cards only for salons they still cover');
  end if;
  if v_body is null or length(v_body) > 2000 then
    raise exception using errcode = '22023', message = 'an order card needs a note of 1 to 2000 characters';
  end if;
  if p_lines is not null then perform app.assert_card_lines(p_lines); end if;
  v_next := app.card_version(k.id) + 1;
  if v_next > 51 then
    raise exception using errcode = '55000', message = 'a request is edited at most 50 times; cancel it and send a new one';
  end if;
  perform app.set_purpose('order card edited');
  insert into public.order_intake_card_version (client_id, card_id, version, body, edited_by)
  values (p_client_id, k.id, v_next, v_body, auth.uid());
  if p_lines is not null then perform app.insert_card_lines(k.id, v_next, p_lines); end if;
  return jsonb_build_object('card_id', k.id, 'version', v_next);
end $$;

-- The rep cancels its own open card, with an optional reason (at most 500 characters). Calling it
-- again on the card it cancelled returns the same answer.
create function app.rep_cancel_card(p_card_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_actor_ready();
  k        public.order_intake_card;
  x        public.order_intake_card_close;
  v_reason text := app.blank_to_null(p_reason);
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps cancel their order cards'); end if;
  if length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'a reason has at most 500 characters';
  end if;
  select * into k from public.order_intake_card c where c.id = p_card_id for update;
  if k.id is null or k.submitter_kind <> 'rep' or k.rep_id is distinct from auth.uid() then
    perform app.raise_denied('reps cancel only their own order cards');
  end if;
  select * into x from public.order_intake_card_close c where c.card_id = k.id;
  if x.id is not null then
    if x.outcome = 'cancelled' and x.closed_by = auth.uid() then
      return jsonb_build_object('card_id', k.id, 'status', 'cancelled');      -- replay
    end if;
    raise exception using errcode = '55000', message = 'this order card was already reviewed or cancelled; it can no longer change';
  end if;
  perform app.set_purpose('order card cancelled by its rep');
  insert into public.order_intake_card_close (card_id, outcome, reason, closed_by)
  values (k.id, 'cancelled', v_reason, auth.uid());
  return jsonb_build_object('card_id', k.id, 'status', 'cancelled');
end $$;

-- Migration 20261104090000's list, with the current version's note and lines (no prices: a salon's
-- price is the office's to quote) and cancelled cards. Same order and cap.
drop function app.my_cards();
create function app.my_cards()
returns table (card_id uuid, salon_id uuid, salon_name text, body text, created_at timestamptz, status text,
               order_id uuid, reason text, version integer, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.assert_actor_ready() <> 'rep' then perform app.raise_denied('order cards are listed for reps only'); end if;
  return query
  select c.id, c.salon_id, case when app.rep_can_reach_salon(c.salon_id) then s.name end, app.card_body(c.id),
         c.created_at, coalesce(x.outcome, 'open'), x.order_id, x.reason, v.version,
         app.card_lines_shown(c.id, v.version, false)
  from public.order_intake_card c
  join public.salon s on s.id = c.salon_id
  left join public.order_intake_card_close x on x.card_id = c.id
  cross join lateral (select app.card_version(c.id) as version) v
  where c.rep_id = auth.uid()
  order by c.created_at desc, c.id
  limit 50;
end $$;

-- ------------------------------------------------------------ office queue ----
-- The office's Requests queue: every rep card and salon request not yet closed, oldest first, up to
-- 200, with its current version, lines, the database's price per line and the estimate (what
-- app.office_create_order would charge for those lines with no price typed).
drop function app.office_open_cards();
create function app.office_open_cards()
returns table (card_id uuid, salon_id uuid, salon_name text, submitter_kind text, rep_id uuid, rep_name text, body text,
               created_at timestamptz, version integer, updated_at timestamptz, lines jsonb, estimate_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select c.id, c.salon_id, s.name, c.submitter_kind, c.rep_id, u.full_name, app.card_body(c.id), c.created_at,
         v.version, app.card_updated_at(c.id), app.card_lines_shown(c.id, v.version, true),
         (select sum(l.qty::bigint * coalesce(app.salon_price(c.salon_id, k.id), k.list_price_paisa))::bigint
            from public.order_intake_card_line l join public.sku k on k.id = l.sku_id
           where l.card_id = c.id and l.version = v.version)
  from public.order_intake_card c
  join public.salon s on s.id = c.salon_id
  left join public.user_profile u on u.id = c.rep_id
  cross join lateral (select app.card_version(c.id) as version) v
  where not exists (select 1 from public.order_intake_card_close x where x.card_id = c.id)
  order by c.created_at, c.id
  limit 200;
end $$;

-- --------------------------------------------------------- office order path ----
-- Migration 20261105100000's version, with three changes for slice 6: p_card_version (when given, the
-- card's current version must still be that one, else 55000: the office converts what it saw); with
-- a card and no lines, the card's current lines are used (one click; a note with no lines still needs
-- lines from the office, 22023 from app.build_order); and a salon's request becomes a salon_portal
-- order. The lines carry no price unless the office types one; the order engine prices them.
drop function app.office_create_order(uuid, uuid, public.plan_code, jsonb, uuid, uuid);
create function app.office_create_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_lines jsonb,
  p_assigned_rep_id uuid default null, p_intake_card_id uuid default null, p_card_version integer default null)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.assert_office();
  o         public.sales_order;
  v_area    uuid;
  v_direct  uuid;
  k         public.order_intake_card;
  v_lines   jsonb := p_lines;
  v_channel public.order_channel := 'office';
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an order needs a client_id (idempotency key, H-08)';
  end if;
  select * into o from public.sales_order where client_id = p_client_id;
  if o.id is not null then
    if o.created_by = auth.uid() and o.salon_id = p_salon_id and o.plan = p_plan
       and o.intake_card_id is not distinct from p_intake_card_id then
      return o;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_card_version is not null and p_intake_card_id is null then
    raise exception using errcode = '22023', message = 'a request version needs the request';
  end if;
  if p_intake_card_id is not null then
    select * into k from public.order_intake_card c where c.id = p_intake_card_id for update;   -- one close per card
    if k.id is null then raise exception using errcode = '22023', message = 'unknown order card'; end if;
    if k.salon_id is distinct from p_salon_id then
      raise exception using errcode = '22023', message = 'the order card is for another salon';
    end if;
    -- A concurrent call with this client_id may have converted the card while this one waited on the
    -- lock: check the replay again now that its order is visible, before the already-closed test.
    select * into o from public.sales_order where client_id = p_client_id;
    if o.id is not null then
      if o.created_by = auth.uid() and o.salon_id = p_salon_id and o.plan = p_plan
         and o.intake_card_id is not distinct from p_intake_card_id then
        return o;                                                              -- replay
      end if;
      raise exception using errcode = '23505', message = 'client_id already used with different content';
    end if;
    if exists (select 1 from public.order_intake_card_close x where x.card_id = k.id) then
      raise exception using errcode = '55000', message = 'this order card is already closed';
    end if;
    if p_card_version is not null and app.card_version(k.id) <> p_card_version then
      raise exception using errcode = '55000', message = 'this request changed after you opened it: reload and check it again';
    end if;
    if v_lines is null then v_lines := app.card_order_lines(k.id, app.card_version(k.id)); end if;
    if k.submitter_kind = 'salon' then v_channel := 'salon_portal'; end if;
  end if;
  select s.area_id into v_area from public.salon s where s.id = p_salon_id;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  v_direct := app.salon_direct_rep(p_salon_id);
  if p_assigned_rep_id is not null and v_direct is not null and p_assigned_rep_id <> v_direct then
    raise exception using errcode = '22023', message = 'this salon is assigned to another rep (D-36)';
  end if;
  if p_assigned_rep_id is not null and not (
       exists (select 1 from public.user_profile u
                where u.id = p_assigned_rep_id and u.role = 'rep' and u.status = 'active')
       and app.rep_holds_salon(p_assigned_rep_id, p_salon_id)) then
    raise exception using errcode = '22023',
      message = 'the assigned rep must be an active rep who covers this salon''s territory';
  end if;
  o := app.build_order(p_client_id, p_salon_id, p_plan,
                       case when p_assigned_rep_id is null then 'warehouse' else 'bag_now' end::public.delivery_mode,
                       v_lines, v_channel, null, null, null, p_assigned_rep_id, p_intake_card_id, null);
  if p_intake_card_id is not null then
    perform app.set_purpose(case when v_channel = 'salon_portal' then 'salon request converted' else 'order card converted' end);
    insert into public.order_intake_card_close (card_id, outcome, order_id, closed_by)
    values (p_intake_card_id, 'converted', o.id, auth.uid());
  end if;
  return o;
end $$;

-- ---------------------------------------------------------- salon requests ----
-- SAL-12, ORD-11 (D-34, D-41): the salon sends a request for its own salon, which must be approved
-- (D-35). Lines are required; the note is optional. Replay on client_id (H-08): the same login, salon,
-- note and lines get the same request back; anything else on that key is 23505.
create function app.salon_submit_request(p_client_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid := app.assert_salon_member();
  v_note  text := app.card_note(p_note);
  k       public.order_intake_card;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a request needs a client_id (idempotency key, H-08)';
  end if;
  select * into k from public.order_intake_card c where c.client_id = p_client_id;
  if k.id is not null then
    if k.submitter_kind = 'salon' and k.salon_user_id = auth.uid() and k.salon_id = v_salon
       and k.body is not distinct from v_note and app.card_stored_key(k.id, 1) = app.card_lines_key(p_lines) then
      return jsonb_build_object('request_id', k.id, 'version', app.card_version(k.id), 'created_at', k.created_at);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.assert_salon_approved(v_salon);
  perform app.assert_card_lines(p_lines);
  perform app.set_purpose('salon request sent');
  insert into public.order_intake_card (client_id, salon_id, submitter_kind, salon_user_id, body)
  values (p_client_id, v_salon, 'salon', auth.uid(), v_note)
  returning * into k;
  perform app.insert_card_lines(k.id, 1, p_lines);
  return jsonb_build_object('request_id', k.id, 'version', 1, 'created_at', k.created_at);
end $$;

-- B-40 (d): the salon edits its own request until the office reviews it. The whole request is given
-- again (lines and note) and becomes a new version. A request of another salon and an unknown id get
-- the same refusal (42501).
create function app.salon_edit_request(p_client_id uuid, p_request_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid := app.assert_salon_member();
  v_note  text := app.card_note(p_note);
  k       public.order_intake_card;
  v       public.order_intake_card_version;
  v_next  integer;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an edit needs a client_id (idempotency key, H-08)';
  end if;
  select * into v from public.order_intake_card_version x where x.client_id = p_client_id;
  if v.id is not null then
    if v.card_id = p_request_id and v.edited_by_salon_user = auth.uid() and v.body is not distinct from v_note
       and app.card_stored_key(v.card_id, v.version) = app.card_lines_key(p_lines) then
      return jsonb_build_object('request_id', v.card_id, 'version', v.version);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into k from public.order_intake_card c where c.id = p_request_id for update;
  if k.id is null or k.submitter_kind <> 'salon' or k.salon_id <> v_salon then
    perform app.raise_denied('no such request for your salon');
  end if;
  if exists (select 1 from public.order_intake_card_version x where x.client_id = p_client_id) then
    raise exception using errcode = '23505', message = 'client_id already used; reload and try again';
  end if;
  if exists (select 1 from public.order_intake_card_close x where x.card_id = k.id) then
    raise exception using errcode = '55000', message = 'this request was already reviewed or cancelled; it can no longer change';
  end if;
  perform app.assert_card_lines(p_lines);
  v_next := app.card_version(k.id) + 1;
  if v_next > 51 then
    raise exception using errcode = '55000', message = 'a request is edited at most 50 times; cancel it and send a new one';
  end if;
  perform app.set_purpose('salon request edited');
  insert into public.order_intake_card_version (client_id, card_id, version, body, edited_by_salon_user)
  values (p_client_id, k.id, v_next, v_note, auth.uid());
  perform app.insert_card_lines(k.id, v_next, p_lines);
  return jsonb_build_object('request_id', k.id, 'version', v_next);
end $$;

-- B-40 (d): the salon cancels its own request until the office reviews it, with an optional reason of
-- at most 500 characters. Calling it again on the request it cancelled returns the same answer.
create function app.salon_cancel_request(p_request_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_salon  uuid := app.assert_salon_member();
  v_reason text := app.blank_to_null(p_reason);
  k        public.order_intake_card;
  x        public.order_intake_card_close;
begin
  if length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'a reason has at most 500 characters';
  end if;
  select * into k from public.order_intake_card c where c.id = p_request_id for update;
  if k.id is null or k.submitter_kind <> 'salon' or k.salon_id <> v_salon then
    perform app.raise_denied('no such request for your salon');
  end if;
  select * into x from public.order_intake_card_close c where c.card_id = k.id;
  if x.id is not null then
    if x.outcome = 'cancelled' and x.closed_by_salon_user = auth.uid() then
      return jsonb_build_object('request_id', k.id, 'status', 'cancelled');   -- replay
    end if;
    raise exception using errcode = '55000', message = 'this request was already reviewed or cancelled; it can no longer change';
  end if;
  perform app.set_purpose('salon request cancelled');
  insert into public.order_intake_card_close (card_id, outcome, reason, closed_by_salon_user)
  values (k.id, 'cancelled', v_reason, auth.uid());
  return jsonb_build_object('request_id', k.id, 'status', 'cancelled');
end $$;

-- -------------------------------------------------------------- salon reads ----
-- The catalogue the salon orders from: active SKUs of active products that have a list price, with
-- the salon's own price when the office set one, else the list price (R6). The picture is a storage
-- object name; the bucket's policy lets an active salon member read it. Up to 1000 rows.
create function app.salon_catalogue()
returns table (product_id uuid, brand_label text, product_name text, description text, image_path text,
               group_name text, sku_id uuid, code text, variant text, unit text, size_value numeric,
               price_paisa bigint, own_price boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select p.id, p.brand_label, p.name, p.description, p.image_path, g.name, k.id, k.code, k.variant, k.unit, k.size_value,
         coalesce(x.price, k.list_price_paisa), x.price is not null
  from public.sku k
  join public.product p on p.id = k.product_id
  join public.product_group g on g.id = p.product_group_id
  cross join lateral (select app.salon_price(v_salon, k.id) as price) x
  where k.active and p.active and k.list_price_paisa is not null
  order by p.name, k.code, k.id
  limit 1000;
end $$;

-- The salon's own requests (not the reps' cards, which are internal notes), newest 50, each with its
-- current version, note, lines at the salon's prices, and how it ended: open, converted (with the
-- order), dismissed (rejected, with the office's reason) or cancelled.
create function app.salon_my_requests()
returns table (request_id uuid, created_at timestamptz, updated_at timestamptz, version integer, note text, lines jsonb,
               status text, order_id uuid, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select c.id, c.created_at, app.card_updated_at(c.id), v.version, app.card_body(c.id),
         app.card_lines_shown(c.id, v.version, true), coalesce(x.outcome, 'open'), x.order_id, x.reason
  from public.order_intake_card c
  left join public.order_intake_card_close x on x.card_id = c.id
  cross join lateral (select app.card_version(c.id) as version) v
  where c.salon_id = v_salon and c.submitter_kind = 'salon'
  order by c.created_at desc, c.id
  limit 50;
end $$;

-- The salon's official orders, whoever made them, newest 50: status, plan, amounts and lines. No rep,
-- no creator, no credit or discount hold details.
create function app.salon_my_orders()
returns table (order_id uuid, created_at timestamptz, status public.order_status, plan public.plan_code,
               subtotal_paisa bigint, discount_paisa bigint, total_paisa bigint, from_request boolean, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select o.id, o.created_at, o.status, o.plan, o.subtotal_paisa, o.discount_paisa, o.total_paisa,
         o.source_channel = 'salon_portal',
         coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'code', k.code, 'product_name', p.name,
                                                       'variant', k.variant, 'qty', l.qty,
                                                       'unit_price_paisa', l.unit_price_paisa,
                                                       'line_total_paisa', l.line_total_paisa) order by l.line_no)
                   from public.sales_order_line l
                   join public.sku k on k.id = l.sku_id
                   join public.product p on p.id = k.product_id
                   where l.order_id = o.id), '[]'::jsonb)
  from public.sales_order o
  where o.salon_id = v_salon
  order by o.created_at desc, o.id
  limit 50;
end $$;

-- The salon's account: the balance derived from its installments (invoiced, paid, owed, overdue,
-- next due date), what is still due, and its payments with their receipt numbers, newest 50. Only
-- method, amount, time and receipt number: no recorder, GPS, flags or bank reference.
create function app.salon_my_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_salon uuid := app.assert_salon_member();
  v_bal   jsonb;
begin
  select jsonb_build_object(
           'invoiced_paisa', coalesce(sum(x.amount_due_paisa), 0)::bigint,
           'paid_paisa', coalesce(sum(x.paid_paisa), 0)::bigint,
           'balance_paisa', coalesce(sum(x.remaining_paisa), 0)::bigint,
           'overdue_paisa', coalesce(sum(x.remaining_paisa) filter (where x.status = 'overdue'), 0)::bigint,
           'next_due_on', min(x.due_on) filter (where x.remaining_paisa > 0))
    into v_bal
  from app.installment_state(v_salon) x;
  return jsonb_build_object(
    'balance', v_bal,
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_number', x.invoice_number, 'seq', x.seq, 'of_count', x.of_count,
                                          'due_on', x.due_on, 'amount_due_paisa', x.amount_due_paisa,
                                          'paid_paisa', x.paid_paisa, 'remaining_paisa', x.remaining_paisa,
                                          'status', x.status)
                       order by x.due_on, x.issued_at, x.invoice_number, x.seq)
      from (select * from app.installment_state(v_salon) y where y.remaining_paisa > 0
            order by y.due_on, y.issued_at, y.invoice_number, y.seq limit 50) x), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('receipt_number', t.number, 'paid_at', t.recorded_at, 'method', t.method,
                                          'amount_paisa', t.amount_paisa)
                       order by t.recorded_at desc, t.seq desc)
      from (select r.number, p.recorded_at, p.method, p.amount_paisa, p.seq
            from public.payment p join public.receipt r on r.payment_id = p.id
            where p.salon_id = v_salon
            order by p.recorded_at desc, p.seq desc limit 50) t), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------- function privileges ----
-- Internal helpers: no grant to any role.
revoke execute on function
  app.card_version(uuid), app.card_body(uuid), app.card_updated_at(uuid), app.card_order_lines(uuid, integer),
  app.card_lines_shown(uuid, integer, boolean), app.card_lines_key(jsonb), app.card_stored_key(uuid, integer),
  app.assert_card_lines(jsonb), app.insert_card_lines(uuid, integer, jsonb), app.card_note(text),
  app.my_salon_id(), app.assert_salon_member()
  from public, anon, authenticated, service_role;

revoke all on function
  app.rep_create_card(uuid, uuid, text, uuid, jsonb), app.rep_edit_card(uuid, uuid, text, jsonb),
  app.rep_cancel_card(uuid, text), app.my_cards(), app.office_open_cards(),
  app.office_create_order(uuid, uuid, public.plan_code, jsonb, uuid, uuid, integer),
  app.salon_submit_request(uuid, jsonb, text), app.salon_edit_request(uuid, uuid, jsonb, text),
  app.salon_cancel_request(uuid, text), app.salon_catalogue(), app.salon_my_requests(), app.salon_my_orders(),
  app.salon_my_account()
  from public, anon, authenticated, service_role;
grant execute on function
  app.rep_create_card(uuid, uuid, text, uuid, jsonb), app.rep_edit_card(uuid, uuid, text, jsonb),
  app.rep_cancel_card(uuid, text), app.my_cards(), app.office_open_cards(),
  app.office_create_order(uuid, uuid, public.plan_code, jsonb, uuid, uuid, integer),
  app.salon_submit_request(uuid, jsonb, text), app.salon_edit_request(uuid, uuid, jsonb, text),
  app.salon_cancel_request(uuid, text), app.salon_catalogue(), app.salon_my_requests(), app.salon_my_orders(),
  app.salon_my_account()
  to authenticated;
