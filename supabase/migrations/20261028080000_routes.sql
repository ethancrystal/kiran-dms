-- =============================================================================
-- Kiran DMS · migration 0011 · Thin due-list and manual routes (task P1-16, D-19)
-- Requirements: PIP-03 (a rep's route for a day: ordered stops, each with a reason; built by the
--               manager in Phase 1, the rep can reorder it and add pins), PIP-05 thin (cycle =
--               the product group's default, from the last purchase), PIP-06 thin (due from
--               due − 3 days, at risk from due + 50% of the cycle).
-- Docs: 02 (route, repeat-cycle engine), 04 (cycle_estimate, route, route_stop), 08 §2 (the rep
--       can add pins and re-order the route), 10 (default_cycle_days seeds the due-list).
--
-- Until orders exist (P1-06) the last purchase is an office-entered opening baseline (A-09,
-- MJ L-0151); deliveries will replace it and mark the row basis = 'orders'. The due-list is
-- computed on read, so a change to a product group's default cycle applies at once.
-- Past routes are final for every role. Reps read routes and the due-list only through
-- functions (H-14).
-- =============================================================================

create type public.route_stop_reason as enum (
  'reorder_due', 'collection_due', 'at_risk', 'prospect', 'delivery', 'manual', 'pin_selected');
create type public.route_source as enum ('manager', 'system', 'rep_map_selection');
create type public.cycle_basis  as enum ('opening', 'orders');

-- ------------------------------------------------------------------- tables ----
create table public.cycle_estimate (
  salon_id         uuid not null references public.salon (id),
  product_group_id uuid not null references public.product_group (id),
  last_order_on    date not null,
  cycle_days       integer check (cycle_days between 1 and 365),   -- null: the product group's default (Phase 1)
  basis            public.cycle_basis not null default 'opening',
  basis_orders     integer not null default 0 check (basis_orders >= 0),
  set_by           uuid not null references public.user_profile (id),
  set_at           timestamptz not null default now(),
  primary key (salon_id, product_group_id)
);
create index cycle_estimate_group_idx on public.cycle_estimate (product_group_id);
comment on table public.cycle_estimate is
  'PIP-05 thin (D-19). Last purchase per salon and product group. basis = opening: entered by the office before orders exist (A-09); basis = orders: kept by deliveries (P1-06). Never deleted.';

create table public.route (
  id           uuid primary key default gen_random_uuid(),
  rep_id       uuid not null references public.user_profile (id),
  day          date not null,                                   -- Karachi calendar day
  generated_by public.route_source not null,
  created_by   uuid not null references public.user_profile (id),
  created_at   timestamptz not null default now(),
  unique (rep_id, day)
);
comment on table public.route is
  'PIP-03. One per rep per day. Append-only: the stops change, the route row does not.';

create table public.route_stop (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.route (id),
  sequence   integer not null check (sequence between 1 and 50),
  salon_id   uuid not null references public.salon (id),
  reason     public.route_stop_reason not null,
  added_by   uuid not null references public.user_profile (id),
  created_at timestamptz not null default now(),
  unique (route_id, salon_id),
  constraint route_stop_sequence_key unique (route_id, sequence) deferrable initially deferred
);
create index route_stop_salon_idx on public.route_stop (salon_id);
comment on table public.route_stop is
  'PIP-03. Ordered stops with a reason. Changes only while the route day is today or later; a reorder changes the sequence and nothing else.';

-- ------------------------------------------------------------------- guards ----
create function control.cycle_estimate_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'cycle estimates are replaced, never deleted';
  end if;
  if (new.salon_id, new.product_group_id) is distinct from (old.salon_id, old.product_group_id) then
    raise exception using errcode = '42501', message = 'a cycle estimate belongs to one salon and product group';
  end if;
  return new;
end $$;

create function control.route_stop_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_day date;
begin
  select r.day into v_day from public.route r
  where r.id = case when tg_op = 'DELETE' then old.route_id else new.route_id end;
  if v_day < app.karachi_today() then
    raise exception using errcode = '42501', message = 'a past route is final';
  end if;
  if tg_op = 'UPDATE' and
     (new.id, new.route_id, new.salon_id, new.reason, new.added_by, new.created_at)
     is distinct from (old.id, old.route_id, old.salon_id, old.reason, old.added_by, old.created_at) then
    raise exception using errcode = '42501', message = 'a route stop changes only its place in the route';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger cycle_estimate_guard before update or delete on public.cycle_estimate
  for each row execute function control.cycle_estimate_guard();
create trigger no_truncate before truncate on public.cycle_estimate for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.route for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.route for each statement execute function control.forbid_mutation();
create trigger route_stop_guard before insert or update or delete on public.route_stop
  for each row execute function control.route_stop_guard();
create trigger no_truncate before truncate on public.route_stop for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.cycle_estimate for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.route          for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.route_stop     for each row execute function control.audit_row();

-- ------------------------------------------------------------------ helpers ----
-- True when this rep currently holds the territory of this salon's area.
create function app.rep_holds_salon(p_rep_id uuid, p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.salon s
    join public.area a on a.id = s.area_id
    join public.rep_territory rt on rt.territory_id = a.territory_id and rt.rep_id = p_rep_id and rt.to_date is null
    where s.id = p_salon_id)
$$;

-- [{salon_id, reason}, ...] → ordered rows; a bad uuid or reason raises 22P02.
create function app.parse_route_stops(p_stops jsonb)
returns table (ord integer, salon_id uuid, reason public.route_stop_reason)
language sql immutable set search_path = '' as $$
  select e.ord::integer, (e.val ->> 'salon_id')::uuid, (e.val ->> 'reason')::public.route_stop_reason
  from jsonb_array_elements(p_stops) with ordinality as e(val, ord)
$$;

-- ---------------------------------------------------------------- due-list ----
-- A-09: the office records a salon's last purchase in a product group until deliveries do.
create function app.office_set_last_purchase(p_salon_id uuid, p_product_group_id uuid, p_last_order_on date)
returns public.cycle_estimate
language plpgsql security definer set search_path = '' as $$
declare v public.cycle_estimate;
begin
  perform app.assert_office();
  if p_last_order_on is null or p_last_order_on > app.karachi_today() then
    raise exception using errcode = '22023', message = 'the last purchase date cannot be in the future';
  end if;
  if not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  if not exists (select 1 from public.product_group g where g.id = p_product_group_id and g.active) then
    raise exception using errcode = '22023', message = 'unknown or inactive product group';
  end if;
  select * into v from public.cycle_estimate
  where salon_id = p_salon_id and product_group_id = p_product_group_id for update;
  if v.basis = 'orders' then
    perform app.raise_denied('this cycle is kept by deliveries; an opening date no longer applies');
  end if;
  perform app.set_purpose('opening last purchase');
  insert into public.cycle_estimate as c (salon_id, product_group_id, last_order_on, set_by)
  values (p_salon_id, p_product_group_id, p_last_order_on, auth.uid())
  on conflict (salon_id, product_group_id) do update
    set last_order_on = excluded.last_order_on, set_by = excluded.set_by, set_at = now()
  returning * into v;
  return v;
end $$;

-- PIP-05/06 thin: salons due on a day (default today): due from next_due − 3 days, overdue from
-- next_due, at risk from next_due + half the cycle. Reps see their own territories; the office
-- sees all, optionally one territory. Parked salons are left out. Most urgent first, 50 rows.
create function app.due_list(p_on date default null, p_territory_id uuid default null)
returns table (salon_id uuid, salon_name text, area_name text, stage public.salon_stage, product_group_id uuid,
               product_group_name text, last_order_on date, cycle_days integer, next_due_on date, due_status text)
language sql stable security definer set search_path = '' as $$
  with d as (
    select s.id as sid, s.name as sname, a.name as aname, s.stage as sstage, g.id as gid, g.name as gname,
           c.last_order_on as last_on, coalesce(c.cycle_days, g.default_cycle_days) as cyc,
           coalesce(p_on, app.karachi_today()) as on_day
    from public.cycle_estimate c
    join public.salon s on s.id = c.salon_id
    join public.area a on a.id = s.area_id
    join public.product_group g on g.id = c.product_group_id
    where g.active and s.stage <> 'parked'
      and (p_territory_id is null or a.territory_id = p_territory_id)
      and ((app.self_ok() and app.user_role() = 'rep' and a.territory_id in (select app.my_territory_ids()))
           or app.is_office())
  )
  select d.sid, d.sname, d.aname, d.sstage, d.gid, d.gname, d.last_on, d.cyc, d.last_on + d.cyc,
         case when d.on_day >= d.last_on + d.cyc + ceil(d.cyc / 2.0)::integer then 'at_risk'
              when d.on_day >= d.last_on + d.cyc then 'overdue'
              else 'due' end
  from d
  where d.on_day >= d.last_on + d.cyc - 3
  order by d.last_on + d.cyc, d.sid, d.gid
  limit 50
$$;

-- ------------------------------------------------------------------- routes ----
-- PIP-03 Phase 1: the office sets a rep's stops for today or a later day, in order. The list
-- replaces the day's stops (stops a rep added included). Every salon must be in the rep's
-- current territories; 'pin_selected' is the rep's own reason.
create function app.office_set_route(p_rep_id uuid, p_day date, p_stops jsonb)
returns public.route
language plpgsql security definer set search_path = '' as $$
declare v public.route;
begin
  perform app.assert_office();
  if p_day is null or p_day < app.karachi_today() then
    raise exception using errcode = '22023', message = 'routes are planned for today or a later day';
  end if;
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'routes are planned for active reps';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' then
    raise exception using errcode = '22023', message = 'stops must be a JSON array';
  end if;
  if jsonb_array_length(p_stops) > 50 then
    raise exception using errcode = '22023', message = 'a route has at most 50 stops';
  end if;
  if exists (select 1 from app.parse_route_stops(p_stops) i where i.salon_id is null or i.reason is null) then
    raise exception using errcode = '22023', message = 'every stop needs a salon_id and a reason';
  end if;
  if exists (select 1 from app.parse_route_stops(p_stops) i where i.reason = 'pin_selected') then
    raise exception using errcode = '22023', message = 'pin_selected is the rep''s own reason';
  end if;
  if (select count(distinct i.salon_id) <> count(*) from app.parse_route_stops(p_stops) i) then
    raise exception using errcode = '22023', message = 'a salon appears once in a route';
  end if;
  if exists (select 1 from app.parse_route_stops(p_stops) i where not app.rep_holds_salon(p_rep_id, i.salon_id)) then
    raise exception using errcode = '22023', message = 'every stop must be a salon in the rep''s current territories';
  end if;
  perform app.set_purpose('route set by the office');
  insert into public.route (rep_id, day, generated_by, created_by)
  values (p_rep_id, p_day, 'manager', auth.uid())
  on conflict (rep_id, day) do nothing;
  select * into v from public.route where rep_id = p_rep_id and day = p_day for update;
  delete from public.route_stop where route_id = v.id;
  insert into public.route_stop (route_id, sequence, salon_id, reason, added_by)
  select v.id, i.ord, i.salon_id, i.reason, auth.uid() from app.parse_route_stops(p_stops) i;
  return v;
end $$;

-- Doc 08 §2, MAP-08 thin: the rep adds a salon from the map to today's route, at the end.
-- Idempotent: a salon already on the route returns its stop.
create function app.rep_add_stop(p_salon_id uuid)
returns public.route_stop
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  r      public.route;
  v      public.route_stop;
  v_n    integer;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps add stops to their own route'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps add only salons in their own territories');
  end if;
  perform app.set_purpose('route stop added by the rep');
  insert into public.route (rep_id, day, generated_by, created_by)
  values (auth.uid(), app.karachi_today(), 'rep_map_selection', auth.uid())
  on conflict (rep_id, day) do nothing;
  select * into r from public.route where rep_id = auth.uid() and day = app.karachi_today() for update;
  select * into v from public.route_stop where route_id = r.id and salon_id = p_salon_id;
  if v.id is not null then return v; end if;                                -- replay
  select count(*) into v_n from public.route_stop where route_id = r.id;
  if v_n >= 50 then
    raise exception using errcode = '22023', message = 'a route has at most 50 stops';
  end if;
  insert into public.route_stop (route_id, sequence, salon_id, reason, added_by)
  values (r.id, v_n + 1, p_salon_id, 'pin_selected', auth.uid())
  returning * into v;
  return v;
end $$;

-- PIP-03: the rep puts the stops of its route for today or a later day in a new order.
-- p_stop_ids must name every stop of that route exactly once. Returns the number of stops.
create function app.rep_reorder_route(p_day date, p_stop_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  r      public.route;
  v_n    integer;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps reorder their own route'); end if;
  if p_day is null or p_day < app.karachi_today() then
    perform app.raise_denied('a past route is final');
  end if;
  select * into r from public.route where rep_id = auth.uid() and day = p_day for update;
  if r.id is null then raise exception using errcode = '22023', message = 'no route for that day'; end if;
  select count(*) into v_n from public.route_stop where route_id = r.id;
  if p_stop_ids is null or cardinality(p_stop_ids) <> v_n
     or (select count(distinct x) from unnest(p_stop_ids) x where x is not null) <> v_n
     or exists (select 1 from unnest(p_stop_ids) x
                where not exists (select 1 from public.route_stop s where s.id = x and s.route_id = r.id)) then
    raise exception using errcode = '22023', message = 'name every stop of the route exactly once';
  end if;
  perform app.set_purpose('route reordered by the rep');
  update public.route_stop s set sequence = x.ord::integer
  from unnest(p_stop_ids) with ordinality as x(id, ord)
  where s.id = x.id and s.route_id = r.id and s.sequence <> x.ord;
  return v_n;
end $$;

-- ---------------------------------------------------------------------- reads ----
-- The rep's route for a day (default today), in order, with the salon's nearest due date and
-- whether the rep has visited it that day. Stops outside the rep's current territories are hidden.
create function app.my_route(p_day date default null)
returns table (stop_id uuid, sequence integer, salon_id uuid, salon_name text, area_name text, stage public.salon_stage,
               reason public.route_stop_reason, lat numeric, lng numeric, next_due_on date,
               visited boolean, last_outcome public.visit_outcome)
language sql stable security definer set search_path = '' as $$
  select st.id, st.sequence, s.id, s.name, a.name, s.stage, st.reason, s.lat, s.lng,
         (select min(c.last_order_on + coalesce(c.cycle_days, g.default_cycle_days))
            from public.cycle_estimate c join public.product_group g on g.id = c.product_group_id
           where c.salon_id = s.id and g.active),
         lv.outcome is not null, lv.outcome
  from public.route r
  join public.route_stop st on st.route_id = r.id
  join public.salon s on s.id = st.salon_id
  join public.area a on a.id = s.area_id
  left join lateral (
    select v.outcome from public.visit v join public.rep_day d on d.id = v.rep_day_id
    where d.rep_id = r.rep_id and d.day = r.day and v.salon_id = s.id
    order by v.arrived_at desc, v.id desc limit 1) lv on true
  where app.self_ok() and app.user_role() = 'rep' and r.rep_id = auth.uid()
    and r.day = coalesce(p_day, app.karachi_today())
    and a.territory_id in (select app.my_territory_ids())
  order by st.sequence
$$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.cycle_estimate enable row level security;
alter table public.cycle_estimate force  row level security;
alter table public.route          enable row level security;
alter table public.route          force  row level security;
alter table public.route_stop     enable row level security;
alter table public.route_stop     force  row level security;

-- A rep sees its own route rows (a day, no salon data); cycles and stops are salon data,
-- office-only at the table (H-14).
create policy cycle_estimate_select on public.cycle_estimate for select to authenticated using ((select app.is_office()));
create policy route_select on public.route for select to authenticated
  using ((select app.is_office()) or (rep_id = (select auth.uid()) and (select app.self_ok())));
create policy route_stop_select on public.route_stop for select to authenticated using ((select app.is_office()));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.cycle_estimate, public.route, public.route_stop from public, anon, authenticated, service_role;
grant select on public.cycle_estimate, public.route, public.route_stop to authenticated, service_role;

revoke execute on function
  control.cycle_estimate_guard(), control.route_stop_guard(), app.rep_holds_salon(uuid, uuid), app.parse_route_stops(jsonb),
  app.office_set_last_purchase(uuid, uuid, date), app.due_list(date, uuid),
  app.office_set_route(uuid, date, jsonb), app.rep_add_stop(uuid), app.rep_reorder_route(date, uuid[]),
  app.my_route(date)
  from public, anon, authenticated, service_role;

grant execute on function
  app.office_set_last_purchase(uuid, uuid, date), app.due_list(date, uuid),
  app.office_set_route(uuid, date, jsonb), app.rep_add_stop(uuid), app.rep_reorder_route(date, uuid[]),
  app.my_route(date)
  to authenticated;
