-- A rep can reorder a route after one stop's salon moved away (REP-13).
-- Requirements: PIP-03, REP-13 (remaining-implementation plan C3).
-- app.my_route hides a stop whose salon the rep no longer holds, but app.rep_reorder_route counted every
-- stop, so the rep's list was always one short and every reorder was refused. The function now counts and
-- accepts only the stops the rep can see, puts the named stops first in the order given, and renumbers the
-- hidden stops after them in their old order. It returns the number of visible stops. Same arguments and
-- return type as before; the existing grants stand.
create or replace function app.rep_reorder_route(p_day date, p_stop_ids uuid[])
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
  -- Only the stops the rep can still see (app.my_route's rule): a stop whose salon moved away is hidden
  -- from the rep, so it cannot be named.
  select count(*) into v_n from public.route_stop s
   where s.route_id = r.id and app.rep_holds_salon(auth.uid(), s.salon_id);
  if p_stop_ids is null or cardinality(p_stop_ids) <> v_n
     or (select count(distinct x) from unnest(p_stop_ids) x where x is not null) <> v_n
     or exists (select 1 from unnest(p_stop_ids) x
                where not exists (select 1 from public.route_stop s
                                  where s.id = x and s.route_id = r.id
                                    and app.rep_holds_salon(auth.uid(), s.salon_id))) then
    raise exception using errcode = '22023', message = 'name every stop of the route exactly once';
  end if;
  perform app.set_purpose('route reordered by the rep');
  -- Named stops first, in the order given; hidden stops after them, in their old order.
  update public.route_stop s set sequence = o.n
  from (select t.id, row_number() over (order by (x.ord is null), x.ord, t.sequence)::integer as n
          from public.route_stop t
          left join unnest(p_stop_ids) with ordinality as x(id, ord) on x.id = t.id
         where t.route_id = r.id) o
  where s.id = o.id and s.sequence <> o.n;
  return v_n;
end $$;
