-- 2026-11-18: Remove manual bag count requirement from field rep shift check-in and check-out.
-- Custody of rep bags is maintained via two-party verified warehouse issues and approved deliveries.

-- 1. Update app.rep_check_in to make p_counted optional (default '[]'::jsonb).
-- If no counts are provided, bag_lines is empty and bag_variance_units is 0.
create or replace function app.rep_check_in(p_counted jsonb default '[]'::jsonb,
                                            p_lat numeric default null,
                                            p_lng numeric default null,
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

  -- If counted lines are provided, calculate variance; otherwise proceed with 0 variance.
  if v_bag is not null and p_counted is not null and jsonb_array_length(p_counted) > 0 then
    with counted as (select x.sku_id, x.qty from app.parse_lines(p_counted, true) x),
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

-- 2. Update app.rep_check_out to remove the mandatory daily_close stock count requirement.
create or replace function app.rep_check_out(p_at_client timestamptz default null)
returns public.rep_day
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.rep_day;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps check out'); end if;
  select * into v from public.rep_day where rep_id = auth.uid() and day = app.karachi_today() for update;
  if v.id is null then perform app.raise_denied('no day to close: check in first'); end if;
  if v.status <> 'open' then return v; end if;                             -- replay

  perform app.set_purpose('rep checked out');
  update public.rep_day
     set status = 'closed', check_out_at = now(), check_out_at_client = p_at_client, closed_by = auth.uid()
   where id = v.id returning * into v;
  return v;
end $$;
