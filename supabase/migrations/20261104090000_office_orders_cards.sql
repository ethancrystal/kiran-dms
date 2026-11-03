-- =============================================================================
-- Kiran DMS · migration 0025 · Office orders and rep order cards (PR A, D-30)
-- Requirements: ORD-01 (an order records its salon, lines and who made it), ORD-10 (idempotent),
--               doc 04 invariant 1 (append-only), H-13 (RLS enabled and forced).
-- Docs: docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md section 4 (PR A);
--       ACTIVITY D-30 (MJ: reps no longer create orders; the office does, directly or from a rep's
--       card; the salon portal is reserved), L-0363, L-0385 (a rep-less order is delivered by the office).
--
-- What is built (schema only; the functions that use it come in later tasks of PR A):
--   * public.order_channel and sales_order.source_channel (rep_visit, office, salon_portal). Every
--     existing order is a rep_visit order. The column keeps a default of rep_visit only so that the
--     rep path app.create_order, which is refused for reps in a later task, still inserts today.
--   * sales_order.created_by (the auth user who made the order; backfilled from rep_id), assigned_rep_id
--     (the rep who delivers and, later, earns commission on it) and intake_card_id (the card it came from).
--   * sales_order.rep_id and rep_day_id become optional, and invoice.rep_id too, so an office order that
--     has no rep can be delivered and invoiced by the office. A check keeps both shapes honest.
--   * public.order_intake_card (a rep's note of what a salon needs) and public.order_intake_card_close
--     (converted into an order, or dismissed with a reason). Both are append-only and audited.
--   * The order immutability trigger now also fixes channel, creator, assigned rep and source card.
-- =============================================================================

-- ------------------------------------------------------------------ channel ----
create type public.order_channel as enum ('rep_visit', 'office', 'salon_portal');

alter table public.sales_order
  add column source_channel  public.order_channel not null default 'rep_visit',
  add column created_by      uuid references public.user_profile (id),
  add column assigned_rep_id uuid references public.user_profile (id),
  add column intake_card_id  uuid;                                   -- FK below, once the card table exists

-- The immutability trigger forbids changing these columns, so the backfill of the rows that exist
-- runs with ordinary triggers off (this migration is the only place that does it).
set local session_replication_role = replica;
update public.sales_order set created_by = rep_id, source_channel = 'rep_visit';
set local session_replication_role = origin;

alter table public.sales_order alter column created_by set not null;
alter table public.sales_order alter column rep_id drop not null;
alter table public.sales_order alter column rep_day_id drop not null;
alter table public.invoice alter column rep_id drop not null;

alter table public.sales_order
  add constraint sales_order_channel_shape check (
    (source_channel <> 'rep_visit' or (rep_id is not null and rep_day_id is not null))
    and (source_channel <> 'office' or (rep_id is null and rep_day_id is null)));

comment on column public.sales_order.source_channel is
  'D-30. Where the order came from: rep_visit (existing rep orders), office (made by the owner or a manager), salon_portal (reserved).';
comment on column public.sales_order.created_by is
  'D-30. The signed-in user who made the order; for a rep_visit order it is the rep.';
comment on column public.sales_order.assigned_rep_id is
  'D-30. The rep who delivers the order and later earns commission on it; null for an office order delivered by the office.';
comment on column public.sales_order.intake_card_id is
  'D-30. The rep order card this order was made from, when it came from one.';

-- An order made without naming its creator (the rep path, direct inserts) is its rep's own.
create function control.sales_order_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, new.rep_id);
  return new;
end $$;

create trigger sales_order_creator before insert on public.sales_order
  for each row execute function control.sales_order_creator();

create index sales_order_assigned_rep_idx on public.sales_order (assigned_rep_id, created_at) where assigned_rep_id is not null;

-- Amounts, parties and lines are fixed at creation; the status moves forward only.
create or replace function control.sales_order_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'orders are never deleted; cancel them';
  end if;
  if (new.id, new.client_id, new.salon_id, new.rep_id, new.rep_day_id, new.visit_id, new.plan, new.delivery_mode,
      new.subtotal_paisa, new.discount_paisa, new.total_paisa, new.discount_approval_id, new.created_at,
      new.created_at_client, new.source_channel, new.created_by, new.assigned_rep_id, new.intake_card_id)
     is distinct from
     (old.id, old.client_id, old.salon_id, old.rep_id, old.rep_day_id, old.visit_id, old.plan, old.delivery_mode,
      old.subtotal_paisa, old.discount_paisa, old.total_paisa, old.discount_approval_id, old.created_at,
      old.created_at_client, old.source_channel, old.created_by, old.assigned_rep_id, old.intake_card_id) then
    raise exception using errcode = '42501', message = 'an order''s parties and amounts are immutable';
  end if;
  if old.status in ('cancelled', 'closed') then
    raise exception using errcode = '42501', message = 'a cancelled or closed order is final';
  end if;
  if old.status <> 'draft' and (new.hold_credit, new.hold_discount, new.credit_snapshot, new.credit_override_by,
                                new.credit_override_reason, new.confirmed_at)
                               is distinct from (old.hold_credit, old.hold_discount, old.credit_snapshot,
                                                 old.credit_override_by, old.credit_override_reason, old.confirmed_at) then
    raise exception using errcode = '42501', message = 'a confirmed order''s checks are final';
  end if;
  if new.status is distinct from old.status and (old.status, new.status) not in (
       ('draft'::public.order_status, 'confirmed'::public.order_status), ('draft', 'cancelled'),
       ('confirmed', 'cancelled'), ('confirmed', 'partially_delivered'), ('confirmed', 'delivered'),
       ('partially_delivered', 'delivered'), ('delivered', 'closed')) then
    raise exception using errcode = '42501', message = 'that order status change is not allowed (ORD-03)';
  end if;
  return new;
end $$;

-- -------------------------------------------------------------------- cards ----
create table public.order_intake_card (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique,                                  -- idempotency key from the phone (H-08)
  salon_id    uuid not null references public.salon (id),
  rep_id      uuid not null references public.user_profile (id),
  rep_day_id  uuid not null references public.rep_day (id),
  visit_id    uuid references public.visit (id),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index order_intake_card_rep_idx   on public.order_intake_card (rep_id, created_at desc);
create index order_intake_card_salon_idx on public.order_intake_card (salon_id, created_at desc);
comment on table public.order_intake_card is
  'D-30. Append-only. A rep''s note of what a salon needs; it is not an order. The office turns it into an order or dismisses it (order_intake_card_close).';

create table public.order_intake_card_close (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null unique references public.order_intake_card (id),   -- a card closes once
  outcome   text not null check (outcome in ('converted', 'dismissed')),
  order_id  uuid references public.sales_order (id),
  reason    text,
  closed_by uuid not null references public.user_profile (id),
  closed_at timestamptz not null default now(),
  constraint order_intake_card_close_shape check (
    (outcome = 'converted' and order_id is not null and reason is null)
    or (outcome = 'dismissed' and order_id is null and length(btrim(coalesce(reason, ''))) >= 5))
);
create index order_intake_card_close_order_idx on public.order_intake_card_close (order_id) where order_id is not null;
comment on table public.order_intake_card_close is
  'D-30. Append-only. How a card ended: converted into an order, or dismissed with a reason of at least 5 characters.';

alter table public.sales_order
  add constraint sales_order_intake_card_fk foreign key (intake_card_id) references public.order_intake_card (id);
create unique index sales_order_intake_card_idx on public.sales_order (intake_card_id) where intake_card_id is not null;

-- ----------------------------------------------------------------- guards ------
create trigger append_only before update or delete on public.order_intake_card       for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card               for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.order_intake_card_close for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card_close         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.order_intake_card       for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.order_intake_card_close for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.order_intake_card       enable row level security;
alter table public.order_intake_card       force  row level security;
alter table public.order_intake_card_close enable row level security;
alter table public.order_intake_card_close force  row level security;

-- The office reads all; a rep reads its own cards, and how they ended, on its approved phone.
create policy order_intake_card_select on public.order_intake_card for select to authenticated
  using ((select app.is_office())
         or (rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy order_intake_card_close_select on public.order_intake_card_close for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.order_intake_card c where c.id = card_id and c.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.order_intake_card, public.order_intake_card_close from public, anon, authenticated, service_role;
grant select on public.order_intake_card, public.order_intake_card_close to authenticated, service_role;

revoke execute on function control.sales_order_creator() from public, anon, authenticated, service_role;
