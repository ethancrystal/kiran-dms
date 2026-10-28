-- =============================================================================
-- Kiran DMS · migration 0010 · Rep day and visits (task P1-02, part b)
-- Requirements: PIP-02 (visit: salon, rep, server arrival time, client time, GPS, outcome,
--               notes; append-only), PIP-09 (daily check-in / check-out gating: no field
--               work without an open day; an unclosed day blocks the next one unless the
--               office closes it with a reason)
-- Docs: 02 (stages), 04 (rep_day, visit), 08 §3 (check-in with bag count, rule 7 every visit
--       has an outcome), 13 R8 and D-06 (fake visits: GPS, distance, mock-location flag).
--
-- Server time is authoritative (arrived_at = now()); the phone's time is kept only as
-- evidence in *_client columns (H-09). Visits never change and are never deleted (H-06).
-- A visit moves the salon's stage only through app.move_stage (stage_event, migration 0009).
-- =============================================================================

create type public.visit_outcome as enum (
  'order', 'collection', 'sample', 'quote', 'intro', 'no_decision', 'closed_not_interested', 'not_present');
create type public.rep_day_status as enum ('open', 'closed', 'force_closed');

-- ------------------------------------------------------------------- tables ----
create table public.rep_day (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              uuid not null references public.user_profile (id),
  day                 date not null,                              -- Karachi calendar day
  status              public.rep_day_status not null default 'open',
  check_in_at         timestamptz not null default now(),
  check_in_at_client  timestamptz,
  check_in_lat        numeric(9, 6) check (check_in_lat between -90 and 90),
  check_in_lng        numeric(9, 6) check (check_in_lng between -180 and 180),
  bag_lines           jsonb not null default '[]'::jsonb,         -- [{sku_id, expected, counted}] at check-in
  bag_variance_units  integer not null default 0,
  check_out_at        timestamptz,
  check_out_at_client timestamptz,
  closed_by           uuid references public.user_profile (id),
  close_reason        text check (length(close_reason) <= 300),
  created_at          timestamptz not null default now(),
  unique (rep_id, day),
  constraint rep_day_geo_pair check ((check_in_lat is null) = (check_in_lng is null)),
  constraint rep_day_close_shape check (
    (status = 'open' and check_out_at is null and closed_by is null) or
    (status = 'closed' and check_out_at is not null and closed_by = rep_id) or
    (status = 'force_closed' and check_out_at is not null and closed_by is not null and closed_by <> rep_id
     and length(btrim(coalesce(close_reason, ''))) >= 3))
);
create index rep_day_open_idx on public.rep_day (rep_id) where status = 'open';
comment on table public.rep_day is
  'PIP-09. One per rep per Karachi day. Field work needs an open day; an earlier open day blocks check-in until the rep or the office closes it. Changes once: open → closed (the rep) or force_closed (the office, with a reason).';

create table public.visit (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null unique,
  rep_day_id          uuid not null references public.rep_day (id),
  rep_id              uuid not null references public.user_profile (id),
  salon_id            uuid not null references public.salon (id),
  outcome             public.visit_outcome not null,
  arrived_at          timestamptz not null default now(),
  arrived_at_client   timestamptz,
  lat                 numeric(9, 6) not null check (lat between -90 and 90),
  lng                 numeric(9, 6) not null check (lng between -180 and 180),
  distance_from_pin_m integer check (distance_from_pin_m >= 0),   -- null when the salon has no pin
  mock_location       boolean not null default false,              -- reported by the phone (doc 13 R8)
  notes               text check (length(notes) <= 500),
  created_at          timestamptz not null default now()
);
create index visit_salon_idx on public.visit (salon_id, arrived_at);
create index visit_rep_day_idx on public.visit (rep_day_id);
create index visit_rep_idx on public.visit (rep_id, arrived_at);
comment on table public.visit is
  'PIP-02. Append-only (doc 04 invariant 1). GPS, distance from the salon pin and the mock-location flag feed the fake-visit detectors (doc 13 D-06).';

-- ------------------------------------------------------------------- guards ----
create function control.rep_day_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'rep days are never deleted';
  end if;
  if old.status <> 'open' then
    raise exception using errcode = '42501', message = 'a closed rep day is final';
  end if;
  if (new.id, new.rep_id, new.day, new.check_in_at, new.check_in_at_client, new.check_in_lat, new.check_in_lng,
      new.bag_lines, new.bag_variance_units, new.created_at)
     is distinct from
     (old.id, old.rep_id, old.day, old.check_in_at, old.check_in_at_client, old.check_in_lat, old.check_in_lng,
      old.bag_lines, old.bag_variance_units, old.created_at)
     or new.status = 'open' then
    raise exception using errcode = '42501', message = 'a rep day changes only by being closed';
  end if;
  return new;
end $$;

create trigger rep_day_guard before update or delete on public.rep_day for each row execute function control.rep_day_guard();
create trigger no_truncate before truncate on public.rep_day for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.visit for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.visit for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.rep_day for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.visit   for each row execute function control.audit_row();

-- ------------------------------------------------------------------ helpers ----
create function app.karachi_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Karachi')::date
$$;

-- Great-circle distance in metres (haversine; accurate to well under 1% at city scale).
create function app.distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric) returns integer
language sql immutable set search_path = '' as $$
  select round(2 * 6371000 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))))::integer
$$;

-- The calling rep's open day for today, if any.
create function app.my_open_day_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.rep_day d
  where d.rep_id = auth.uid() and d.day = app.karachi_today() and d.status = 'open' and app.user_role() = 'rep'
$$;

-- ----------------------------------------------------------- check-in / out ----
-- PIP-09, doc 08 §3: start the day with the bag counted. An earlier day still open blocks it.
-- The count is recorded against the system figure; a variance never changes stock.
create function app.rep_check_in(p_counted jsonb, p_lat numeric default null, p_lng numeric default null,
                                 p_at_client timestamptz default null)
returns public.rep_day
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  v       public.rep_day;
  v_bag   uuid := app.my_bag_id();
  v_lines jsonb := '[]'::jsonb;
  v_var   integer := 0;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps check in'); end if;
  select * into v from public.rep_day where rep_id = auth.uid() and day = app.karachi_today();
  if v.id is not null then
    if v.status = 'open' then return v; end if;                            -- replay
    perform app.raise_denied('today''s day is already closed');
  end if;
  if exists (select 1 from public.rep_day d where d.rep_id = auth.uid() and d.status = 'open' and d.day < app.karachi_today()) then
    perform app.raise_denied('an earlier day is still open; close it or ask the office to close it (PIP-09)');
  end if;
  if v_bag is not null then
    with counted as (select x.sku_id, x.qty from app.parse_lines(coalesce(p_counted, '[]'::jsonb), true) x),
         skus as (select c.sku_id from counted c
                  union
                  select m.sku_id from public.stock_movement m where m.to_location_id = v_bag or m.from_location_id = v_bag),
         l as (select s.sku_id, app.on_hand(v_bag, s.sku_id) as expected,
                      coalesce((select c.qty from counted c where c.sku_id = s.sku_id), 0) as counted
                 from skus s)
    select coalesce(jsonb_agg(jsonb_build_object('sku_id', l.sku_id, 'expected', l.expected, 'counted', l.counted)
                              order by l.sku_id) filter (where l.expected <> 0 or l.counted <> 0), '[]'::jsonb),
           coalesce(sum(abs(l.counted - l.expected)), 0)::integer
      into v_lines, v_var
      from l;
  end if;
  perform app.set_purpose('rep checked in');
  insert into public.rep_day (rep_id, day, check_in_at_client, check_in_lat, check_in_lng, bag_lines, bag_variance_units)
  values (auth.uid(), app.karachi_today(), p_at_client, p_lat, p_lng, v_lines, v_var)
  returning * into v;
  return v;
end $$;

-- The rep closes today's day. With a bag, the evening daily close must be recorded first (INV-05).
create function app.rep_check_out(p_at_client timestamptz default null)
returns public.rep_day
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.rep_day;
  v_bag  uuid := app.my_bag_id();
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps check out'); end if;
  select * into v from public.rep_day where rep_id = auth.uid() and day = app.karachi_today() for update;
  if v.id is null then perform app.raise_denied('no day to close: check in first'); end if;
  if v.status <> 'open' then return v; end if;                             -- replay
  if v_bag is not null and not exists (
       select 1 from public.stock_count c
       where c.location_id = v_bag and c.kind = 'daily_close' and c.counted_by = auth.uid()
         and c.created_at >= v.check_in_at) then
    perform app.raise_denied('record the evening bag count (daily close) before checking out');
  end if;
  perform app.set_purpose('rep checked out');
  update public.rep_day
     set status = 'closed', check_out_at = now(), check_out_at_client = p_at_client, closed_by = auth.uid()
   where id = v.id returning * into v;
  return v;
end $$;

-- PIP-09 manager override: close a rep's open day (any date) with a reason; always audited.
create function app.office_force_close_rep_day(p_rep_day_id uuid, p_reason text)
returns public.rep_day
language plpgsql security definer set search_path = '' as $$
declare v public.rep_day;
begin
  perform app.assert_office();
  perform app.assert_reason(p_reason);
  select * into v from public.rep_day where id = p_rep_day_id for update;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown rep day'; end if;
  if v.status <> 'open' then return v; end if;
  perform app.set_purpose('rep day closed by the office: ' || p_reason);
  update public.rep_day
     set status = 'force_closed', check_out_at = now(), closed_by = auth.uid(), close_reason = left(p_reason, 300)
   where id = v.id returning * into v;
  return v;
end $$;

-- --------------------------------------------------------------------- visits ----
-- PIP-02: log a visit with an outcome (doc 08 rule 7). Rep on the approved device, an open day
-- today, a salon in the rep's territories. Idempotent on client_id. Moves the stage (doc 02):
-- a first real visit takes a prospect to visited; a sample or quote takes it to trial.
create function app.log_visit(
  p_client_id uuid, p_salon_id uuid, p_outcome public.visit_outcome, p_lat numeric, p_lng numeric,
  p_arrived_at_client timestamptz default null, p_notes text default null, p_mock_location boolean default false)
returns public.visit
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.visit;
  v_day  uuid;
  s      public.salon;
  v_dist integer;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps log visits'); end if;
  select * into v from public.visit where client_id = p_client_id;
  if v.id is not null then
    if v.rep_id = auth.uid() and v.salon_id = p_salon_id and v.outcome = p_outcome then return v; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before logging visits (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps visit only salons in their own territories');
  end if;
  select * into s from public.salon where id = p_salon_id;
  if s.lat is not null and p_lat is not null and p_lng is not null then
    v_dist := app.distance_m(s.lat, s.lng, p_lat, p_lng);
  end if;
  perform app.set_purpose('visit: ' || p_outcome::text);
  insert into public.visit (client_id, rep_day_id, rep_id, salon_id, outcome, arrived_at_client, lat, lng,
                            distance_from_pin_m, mock_location, notes)
  values (p_client_id, v_day, auth.uid(), p_salon_id, p_outcome, p_arrived_at_client, p_lat, p_lng,
          v_dist, coalesce(p_mock_location, false), nullif(btrim(p_notes), ''))
  returning * into v;
  if p_outcome in ('sample', 'quote') and s.stage in ('prospect', 'visited') then
    perform app.move_stage(p_salon_id, 'trial', 'visit', 'visit outcome ' || p_outcome::text);
  elsif p_outcome <> 'not_present' and s.stage = 'prospect' then
    perform app.move_stage(p_salon_id, 'visited', 'visit', 'first visit');
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------- reads ----
create function app.my_day()
returns table (id uuid, day date, status public.rep_day_status, check_in_at timestamptz, bag_variance_units integer,
               visits integer)
language sql stable security definer set search_path = '' as $$
  select d.id, d.day, d.status, d.check_in_at, d.bag_variance_units,
         (select count(*)::integer from public.visit v where v.rep_day_id = d.id)
  from public.rep_day d
  where app.self_ok() and app.user_role() = 'rep' and d.rep_id = auth.uid() and d.day = app.karachi_today()
$$;

-- A salon's visits for a rep who can reach it, or the office (newest first, capped).
create function app.salon_visits(p_salon_id uuid)
returns table (id uuid, rep_id uuid, outcome public.visit_outcome, arrived_at timestamptz, distance_from_pin_m integer,
               notes text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.rep_id, v.outcome, v.arrived_at, v.distance_from_pin_m, v.notes from public.visit v
  where v.salon_id = p_salon_id and (app.rep_can_reach_salon(p_salon_id) or app.is_office())
  order by v.arrived_at desc, v.id
  limit 50
$$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.rep_day enable row level security;
alter table public.rep_day force  row level security;
alter table public.visit   enable row level security;
alter table public.visit   force  row level security;

-- A rep sees its own days (not salon data); visits are salon data, office-only at the table (H-14).
create policy rep_day_select on public.rep_day for select to authenticated
  using ((select app.is_office()) or (rep_id = (select auth.uid()) and (select app.self_ok())));
create policy visit_select on public.visit for select to authenticated using ((select app.is_office()));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.rep_day, public.visit from public, anon, authenticated, service_role;
grant select on public.rep_day, public.visit to authenticated, service_role;

revoke execute on function
  control.rep_day_guard(), app.karachi_today(), app.distance_m(numeric, numeric, numeric, numeric), app.my_open_day_id(),
  app.rep_check_in(jsonb, numeric, numeric, timestamptz), app.rep_check_out(timestamptz),
  app.office_force_close_rep_day(uuid, text),
  app.log_visit(uuid, uuid, public.visit_outcome, numeric, numeric, timestamptz, text, boolean),
  app.my_day(), app.salon_visits(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  app.rep_check_in(jsonb, numeric, numeric, timestamptz), app.rep_check_out(timestamptz),
  app.office_force_close_rep_day(uuid, text),
  app.log_visit(uuid, uuid, public.visit_outcome, numeric, numeric, timestamptz, text, boolean),
  app.my_day(), app.salon_visits(uuid)
  to authenticated;
