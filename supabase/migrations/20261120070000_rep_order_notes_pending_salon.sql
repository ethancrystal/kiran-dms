-- =============================================================================
-- Kiran DMS · migration 20261120070000 · Order Notes for potential salons
-- Decision 2026-11-20-mj-rep-scope-stock-investors (MJ, 2026-11-20): the Rep area
-- has a dedicated Order Notes area where a rep writes down what a POTENTIAL salon
-- client wants. Before this, app.rep_create_card required an approved salon, so a
-- rep could not leave an order note at a prospect. This widens that one gate to
-- pending salons as well; rejected salons are still refused.
--
-- What does NOT change: the canonical append-only entity (order_intake_card), the
-- territory and device checks, the open-day requirement, the note-length and visit
-- checks, idempotency on client_id, and the office conversion path. Converting a
-- note into an order still calls assert_salon_approved, so a prospect's note cannot
-- become an order until the office approves that salon. This keeps D-35 intact for
-- orders while allowing notes at prospects, as MJ ruled.
--
-- Forward-only: create or replace in place (return type unchanged), so grants stay.
-- =============================================================================

create or replace function app.rep_create_card(
  p_client_id uuid, p_salon_id uuid, p_body text, p_visit_id uuid default null,
  p_lines jsonb default null)
returns public.order_intake_card
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.assert_actor_ready();
  k         public.order_intake_card;
  v_day     uuid;
  v_body    text := btrim(p_body);
  v_approval public.salon_approval;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps save order notes'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an order note needs a client_id (idempotency key, H-08)';
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
  if v_day is null then perform app.raise_denied('check in before saving order notes (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps save order notes only for salons in their own territories');
  end if;
  -- MJ 2026-11-20: a note may be left at a potential (pending) salon as well as an
  -- approved one. A rejected salon cannot be noted; the office re-approves it first.
  select s.approval_status into v_approval from public.salon s where s.id = p_salon_id;
  if v_approval is null then perform app.raise_denied('unknown salon'); end if;
  if v_approval = 'rejected' then
    raise exception using errcode = '55000',
      message = 'this salon was rejected; the office must approve it again before an order note is kept';
  end if;
  if v_body is null or length(v_body) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'an order note needs a note of 1 to 2000 characters';
  end if;
  if p_visit_id is not null and not exists (
       select 1 from public.visit v where v.id = p_visit_id and v.rep_id = auth.uid() and v.salon_id = p_salon_id
         and v.rep_day_id = v_day) then
    raise exception using errcode = '22023', message = 'the visit must be the rep''s visit to this salon today';
  end if;
  if p_lines is not null then perform app.assert_card_lines(p_lines); end if;
  perform app.set_purpose('order note saved');
  insert into public.order_intake_card (client_id, salon_id, rep_id, rep_day_id, visit_id, body)
  values (p_client_id, p_salon_id, auth.uid(), v_day, p_visit_id, v_body)
  returning * into k;
  if p_lines is not null then perform app.insert_card_lines(k.id, 1, p_lines); end if;
  return k;
end $$;
