-- P1-31: invoice composer and customer acknowledgement (D-49).
-- Reuses the canonical invoice, the delivery approval transaction (app.finalise_delivery) and the existing document
-- functions. Nothing here issues an invoice: the only path is still app.office_approve_delivery / app.office_deliver.
--
--   1. invoice_draft_version  Display text for an order's next invoice (customer-facing description per product,
--                             notes, payment instructions). Append-only versions; the latest one counts. It never
--                             changes quantities, prices, discounts or SKUs.
--   2. invoice_snapshot       The issued invoice as it was printed: company, customer, lines, totals, schedule, notes,
--                             acknowledgement. Written by a deferred trigger in the same transaction as the invoice,
--                             so finalise_delivery is not touched. Append-only. A reprint reads it.
--   3. delivery_signature     Customer acknowledgement of receipt, bound to the submission and a hash of its exact
--                             lines. Append-only. Its picture is a PNG in delivery_signature_image, a table no API
--                             role can read and the audit trigger does not copy; the office opens it through an
--                             audited function.
--   4. delivery_signature_access   Who opened a picture. delivery_signature_use   Which delivery used an acknowledgement.
--   5. The rule (MJ, 2026-11-05): a delivery is final only with BOTH the salon's signed acknowledgement of exactly the
--      goods delivered AND the manager's or owner's approval. A trigger on the invoice insert enforces it for every
--      path that issues an invoice (the approval of a rep's submission, and the office delivering a rep-less order),
--      so app.finalise_delivery, app.office_approve_delivery and app.office_deliver are not touched. A refusal or
--      an inability to sign is recorded honestly, but it does not satisfy the rule: the delivery cannot be final.
-- An acknowledgement is an electronic proof of receipt, not a legally qualified electronic signature.

-- ------------------------------------------------------------------ tables ---
create table public.invoice_draft_version (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null unique,
  order_id             uuid not null references public.sales_order (id),
  version              integer not null check (version >= 1),
  notes                text check (length(notes) <= 500),
  payment_instructions text check (length(payment_instructions) <= 500),
  line_text            jsonb not null default '{}'::jsonb,   -- {sku_id: customer-facing description}
  saved_by             uuid not null references public.user_profile (id),
  saved_at             timestamptz not null default now(),
  constraint invoice_draft_line_text check (jsonb_typeof(line_text) = 'object'),
  unique (order_id, version)
);
comment on table public.invoice_draft_version is
  'P1-31, D-49. Append-only. Display text for the next invoice of an order; the latest version is applied when an invoice is issued. Never carries quantities, prices, discounts or SKU identity.';

create table public.invoice_snapshot (
  id         uuid not null default gen_random_uuid() unique,
  invoice_id uuid primary key references public.invoice (id),
  document   jsonb not null,
  doc_hash   text not null,
  created_at timestamptz not null default now()
);
comment on table public.invoice_snapshot is
  'P1-31, D-49. Append-only. The invoice as issued; written in the issuing transaction. Reprints and the salon read this, never the live records, so later edits to a salon or the company profile cannot change an issued invoice.';

create table public.delivery_signature (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null unique,
  submission_id         uuid references public.delivery_submission (id),     -- null: taken by the office for a rep-less delivery
  order_id              uuid not null references public.sales_order (id),
  salon_id              uuid not null references public.salon (id),
  rep_id                uuid not null references public.user_profile (id),     -- who recorded it: the delivering rep, or the office user
  device_hash           text not null,                                       -- sha-256 of the device id; the raw id is never stored (B-16)
  outcome               text not null check (outcome in ('signed', 'refused', 'unable')),
  signatory_name        text check (length(btrim(signatory_name)) between 2 and 80),
  signatory_designation text check (length(btrim(signatory_designation)) between 2 and 80),
  statement_version     integer not null,
  statement_text        text not null,
  lines_hash            text not null,
  signature_size        integer,
  signature_hash        text,
  evidence_hash         text not null,
  note                  text check (length(btrim(note)) between 5 and 300),
  signed_at             timestamptz not null default now(),
  constraint delivery_signature_shape check (
    (outcome = 'signed' and signatory_name is not null and signatory_designation is not null
       and signature_hash is not null and signature_size between 200 and 120000)
    or (outcome in ('refused', 'unable') and signature_hash is null and signature_size is null and note is not null))
);
create index delivery_signature_submission_idx on public.delivery_signature (submission_id, signed_at desc);
comment on table public.delivery_signature is
  'P1-31, D-49. Append-only. The salon''s acknowledgement of receipt (or its refusal) for one submission, bound to a hash of that submission''s exact lines. Electronic proof of receipt, not a legally qualified electronic signature.';

create table public.delivery_signature_image (
  signature_id uuid primary key references public.delivery_signature (id),
  png          bytea not null check (length(png) between 200 and 120000)
);
comment on table public.delivery_signature_image is
  'P1-31, D-49. Append-only, never granted to an API role. Read only through app.office_signature_image, which logs the access.';

create table public.delivery_signature_access (
  id           uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.delivery_signature (id),
  accessed_by  uuid not null references public.user_profile (id),
  accessed_at  timestamptz not null default now(),
  purpose      text not null check (length(btrim(purpose)) between 3 and 200)
);
comment on table public.delivery_signature_access is 'P1-31. Append-only. Every time the office opened a signature picture.';

create table public.delivery_signature_use (
  signature_id uuid primary key references public.delivery_signature (id),
  delivery_id  uuid not null unique references public.delivery (id),
  used_at      timestamptz not null default now()
);
comment on table public.delivery_signature_use is
  'P1-31, D-49. Append-only. The delivery an acknowledgement made final. One acknowledgement makes one delivery final, once.';

create trigger append_only before update or delete on public.invoice_draft_version        for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.invoice_draft_version                for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.invoice_snapshot             for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.invoice_snapshot                     for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_signature           for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_signature                   for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_signature_image     for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_signature_image             for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_signature_access    for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_signature_access            for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_signature_use       for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_signature_use               for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.invoice_draft_version        for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.invoice_snapshot             for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_signature           for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_signature_image      for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_signature_access    for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_signature_use       for each row execute function control.audit_row();

alter table public.invoice_draft_version        enable row level security;
alter table public.invoice_draft_version        force  row level security;
alter table public.invoice_snapshot             enable row level security;
alter table public.invoice_snapshot             force  row level security;
alter table public.delivery_signature           enable row level security;
alter table public.delivery_signature           force  row level security;
alter table public.delivery_signature_image     enable row level security;
alter table public.delivery_signature_image     force  row level security;
alter table public.delivery_signature_access    enable row level security;
alter table public.delivery_signature_access    force  row level security;
alter table public.delivery_signature_use       enable row level security;
alter table public.delivery_signature_use       force  row level security;

-- The office reads drafts, snapshots, the access log and the uses. Acknowledgements and pictures are read through
-- functions only (a rep sees just its own status, with no picture).
create policy invoice_draft_version_select on public.invoice_draft_version for select to authenticated
  using ((select app.is_office()));
create policy invoice_snapshot_select on public.invoice_snapshot for select to authenticated
  using ((select app.is_office()));
create policy delivery_signature_access_select on public.delivery_signature_access for select to authenticated
  using ((select app.is_office()));
create policy delivery_signature_use_select on public.delivery_signature_use for select to authenticated
  using ((select app.is_office()));

revoke all on public.invoice_draft_version, public.invoice_snapshot, public.delivery_signature, public.delivery_signature_image,
              public.delivery_signature_access, public.delivery_signature_use
  from public, anon, authenticated, service_role;
grant select on public.invoice_draft_version, public.invoice_snapshot, public.delivery_signature_access,
                public.delivery_signature_use to authenticated, service_role;

-- ----------------------------------------------------- the acknowledgement ----
create function app.delivery_ack_statement() returns jsonb
language sql immutable security definer set search_path = '' as $$
  select jsonb_build_object('version', 1, 'text',
    'I confirm that I have received the goods listed on this screen, in the quantities shown, on behalf of the salon named, and that I am allowed to sign for it. This is a record of receipt, not a legally qualified electronic signature.');
$$;

-- A hash of what is being handed over: the salon, the order and the exact goods, by SKU. p_lines is [{sku_id, qty}].
create function app.delivery_lines_hash(p_salon_id uuid, p_order_id uuid, p_lines jsonb) returns text
language sql immutable security definer set search_path = '' as $$
  select encode(sha256(convert_to(
           p_salon_id::text || '|' || p_order_id::text || '|' ||
           coalesce((select string_agg(k || ':' || q, ',' order by k)
                     from (select e ->> 'sku_id' k, sum((e ->> 'qty')::integer)::text q
                           from jsonb_array_elements(p_lines) e group by e ->> 'sku_id') g), ''), 'utf8')), 'hex');
$$;

-- The same, for a rep's submission.
create function app.submission_lines_hash(p_submission_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select app.delivery_lines_hash(s.salon_id, s.order_id, s.lines) from public.delivery_submission s where s.id = p_submission_id;
$$;

-- The statement a rep puts in front of the customer, so the screen and the record cannot differ.
create function app.delivery_ack_text() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_actor_ready();
  return app.delivery_ack_statement();
end $$;

-- The rep attaches the customer's acknowledgement (or a refusal) to its own undecided submission.
create function app.rep_attach_signature(
  p_client_id uuid, p_submission_id uuid, p_outcome text, p_name text, p_designation text,
  p_png_base64 text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  sub     public.delivery_submission;
  sg      public.delivery_signature;
  st      jsonb := app.delivery_ack_statement();
  v_png   bytea;
  v_hash  text;
  v_lines text;
  v_now   timestamptz := now();
  v_dev   text := encode(sha256(convert_to(coalesce(app.request_device_id(), 'unknown'), 'utf8')), 'hex');   -- never the raw id
begin
  if v_role <> 'rep' then perform app.raise_denied('only the delivering rep attaches the customer''s acknowledgement'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an acknowledgement needs a client_id (idempotency key, H-08)';
  end if;
  select * into sg from public.delivery_signature where client_id = p_client_id;
  if sg.id is not null then
    if sg.rep_id = auth.uid() and sg.submission_id = p_submission_id and sg.outcome = p_outcome then
      return jsonb_build_object('id', sg.id, 'outcome', sg.outcome, 'signed_at', sg.signed_at, 'valid',
                                sg.lines_hash = app.submission_lines_hash(sg.submission_id));      -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_outcome not in ('signed', 'refused', 'unable') then
    raise exception using errcode = '22023', message = 'the outcome is signed, refused or unable';
  end if;
  select * into sub from public.delivery_submission where id = p_submission_id;
  if sub.id is null or sub.rep_id <> auth.uid() then
    perform app.raise_denied('a rep records the acknowledgement of its own submissions only');
  end if;
  if exists (select 1 from public.delivery_submission_decision x where x.submission_id = sub.id) then
    raise exception using errcode = '55000', message = 'this delivery is already decided; its acknowledgement can no longer be added';
  end if;
  v_lines := app.submission_lines_hash(sub.id);
  if p_outcome = 'signed' then
    if length(btrim(coalesce(p_name, ''))) not between 2 and 80 or length(btrim(coalesce(p_designation, ''))) not between 2 and 80 then
      raise exception using errcode = '22023', message = 'the name and the role of the person signing for the salon are required';
    end if;
    begin
      v_png := decode(coalesce(p_png_base64, ''), 'base64');
    exception when others then
      raise exception using errcode = '22023', message = 'the signature picture is not valid';
    end;
    if v_png is null or length(v_png) not between 200 and 120000
       or substring(v_png from 1 for 8) <> '\x89504e470d0a1a0a'::bytea then
      raise exception using errcode = '22023', message = 'the signature must be a PNG picture of a reasonable size';
    end if;
    v_hash := encode(sha256(v_png), 'hex');
  elsif length(btrim(coalesce(p_note, ''))) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'say in a few words why the salon did not sign (5 to 300 characters)';
  end if;
  perform app.set_purpose('customer acknowledgement of receipt');
  insert into public.delivery_signature (client_id, submission_id, order_id, salon_id, rep_id, device_hash, outcome,
      signatory_name, signatory_designation, statement_version, statement_text, lines_hash, signature_size, signature_hash,
      evidence_hash, note, signed_at)
  values (p_client_id, sub.id, sub.order_id, sub.salon_id, auth.uid(), v_dev, p_outcome,
      case when p_outcome = 'signed' then btrim(p_name) end, case when p_outcome = 'signed' then btrim(p_designation) end,
      (st ->> 'version')::integer, st ->> 'text', v_lines, case when v_png is not null then length(v_png) end, v_hash,
      encode(sha256(convert_to(v_lines || '|' || p_outcome || '|' || coalesce(btrim(p_name), '') || '|' || coalesce(btrim(p_designation), '')
        || '|' || (st ->> 'version') || '|' || coalesce(v_hash, '') || '|' || v_dev || '|' || v_now::text, 'utf8')), 'hex'),
      case when p_outcome <> 'signed' then btrim(p_note) end, v_now)
  returning * into sg;
  if v_png is not null then insert into public.delivery_signature_image (signature_id, png) values (sg.id, v_png); end if;
  return jsonb_build_object('id', sg.id, 'outcome', sg.outcome, 'signed_at', sg.signed_at, 'valid', true);
end $$;

-- What the rep may see of its own submission's acknowledgement: no picture.
create function app.my_signature_status(p_submission_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sg public.delivery_signature;
begin
  if app.user_role() is distinct from 'rep' or not coalesce(app.self_ok(), false) then
    perform app.raise_denied('acknowledgements are listed for reps on an approved phone');
  end if;
  select g.* into sg from public.delivery_signature g join public.delivery_submission s on s.id = g.submission_id
   where g.submission_id = p_submission_id and s.rep_id = auth.uid() order by g.signed_at desc, g.id limit 1;
  if sg.id is null then return null; end if;
  return jsonb_build_object('outcome', sg.outcome, 'signatory_name', sg.signatory_name, 'signed_at', sg.signed_at,
                            'valid', sg.lines_hash = app.submission_lines_hash(sg.submission_id));
end $$;

-- The office reads one submission's acknowledgement status (no picture) and any recorded exception.
create function app.office_delivery_signature(p_submission_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sg public.delivery_signature;
begin
  perform app.assert_office();
  if not exists (select 1 from public.delivery_submission where id = p_submission_id) then
    raise exception using errcode = '22023', message = 'unknown delivery submission';
  end if;
  select g.* into sg from public.delivery_signature g where g.submission_id = p_submission_id order by g.signed_at desc, g.id limit 1;
  return jsonb_build_object(
    'signature_id', sg.id,
    'outcome', sg.outcome,
    'signatory_name', sg.signatory_name,
    'signatory_designation', sg.signatory_designation,
    'statement_version', sg.statement_version,
    'signed_at', sg.signed_at,
    'note', sg.note,
    'valid', case when sg.id is null then false else sg.lines_hash = app.submission_lines_hash(p_submission_id) end,
    'has_picture', sg.signature_size is not null);
end $$;

-- The picture, to the office only, as base64; every opening is logged. Nothing is stored or linked, so every look is a
-- fresh authorised call (no URL to share or to keep alive).
create function app.office_signature_image(p_signature_id uuid, p_purpose text) returns text
language plpgsql security definer set search_path = '' as $$
declare im public.delivery_signature_image;
begin
  perform app.assert_office();
  if length(btrim(coalesce(p_purpose, ''))) not between 3 and 200 then
    raise exception using errcode = '22023', message = 'say why you are opening the signature (3 to 200 characters)';
  end if;
  select * into im from public.delivery_signature_image where signature_id = p_signature_id;
  if im.signature_id is null then
    raise exception using errcode = '22023', message = 'there is no signature picture with that id';
  end if;
  perform app.set_purpose('signature picture opened');
  insert into public.delivery_signature_access (signature_id, accessed_by, purpose) values (im.signature_id, auth.uid(), btrim(p_purpose));
  return replace(encode(im.png, 'base64'), E'
', '');                -- one line: a browser data URL cannot hold the wrapping
end $$;

-- A rep-less order is delivered by the office, in front of the customer: the office user records the salon's
-- acknowledgement of exactly the goods about to be delivered (p_lines, or everything still to deliver when null), then
-- calls app.office_deliver with the same goods. Owner or manager at AAL2.
create function app.office_attach_signature(
  p_client_id uuid, p_order_id uuid, p_lines jsonb, p_outcome text, p_name text, p_designation text,
  p_png_base64 text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  o       public.sales_order;
  sg      public.delivery_signature;
  st      jsonb := app.delivery_ack_statement();
  v_lines jsonb;
  v_png   bytea;
  v_hash  text;
  v_lh    text;
  v_now   timestamptz := now();
  v_dev   text := encode(sha256(convert_to(coalesce(app.request_device_id(), 'office'), 'utf8')), 'hex');   -- never the raw id
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an acknowledgement needs a client_id (idempotency key, H-08)';
  end if;
  select * into sg from public.delivery_signature where client_id = p_client_id;
  if sg.id is not null then
    if sg.rep_id = auth.uid() and sg.order_id = p_order_id and sg.submission_id is null and sg.outcome = p_outcome then
      return jsonb_build_object('id', sg.id, 'outcome', sg.outcome, 'signed_at', sg.signed_at);
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_outcome not in ('signed', 'refused', 'unable') then
    raise exception using errcode = '22023', message = 'the outcome is signed, refused or unable';
  end if;
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if o.status not in ('confirmed', 'partially_delivered') then
    raise exception using errcode = '55000', message = 'only an order that is waiting to be delivered has a delivery to acknowledge';
  end if;
  if exists (select 1 from public.delivery_submission s where s.order_id = o.id
               and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)) then
    raise exception using errcode = '55000', message = 'this order has a rep''s delivery waiting for approval; its acknowledgement is taken by the rep';
  end if;
  if p_lines is null then
    select jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.remaining)) into v_lines
    from app.order_lines_left(o.id) x where x.remaining > 0;
  else
    select jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.qty)) into v_lines from app.parse_lines(p_lines) x;
    if exists (select 1 from jsonb_to_recordset(v_lines) g(sku_id uuid, qty integer)
               left join app.order_lines_left(o.id) x on x.sku_id = g.sku_id where x.order_line_id is null or g.qty > x.remaining) then
      raise exception using errcode = '22023', message = 'every line must be a SKU of this order, at most what is left to deliver';
    end if;
  end if;
  if v_lines is null then raise exception using errcode = '22023', message = 'nothing is left to deliver on this order'; end if;
  v_lh := app.delivery_lines_hash(o.salon_id, o.id, v_lines);
  if p_outcome = 'signed' then
    if length(btrim(coalesce(p_name, ''))) not between 2 and 80 or length(btrim(coalesce(p_designation, ''))) not between 2 and 80 then
      raise exception using errcode = '22023', message = 'the name and the role of the person signing for the salon are required';
    end if;
    begin
      v_png := decode(coalesce(p_png_base64, ''), 'base64');
    exception when others then
      raise exception using errcode = '22023', message = 'the signature picture is not valid';
    end;
    if v_png is null or length(v_png) not between 200 and 120000
       or substring(v_png from 1 for 8) <> '\x89504e470d0a1a0a'::bytea then
      raise exception using errcode = '22023', message = 'the signature must be a PNG picture of a reasonable size';
    end if;
    v_hash := encode(sha256(v_png), 'hex');
  elsif length(btrim(coalesce(p_note, ''))) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'say in a few words why the salon did not sign (5 to 300 characters)';
  end if;
  perform app.set_purpose('customer acknowledgement of receipt (office delivery)');
  insert into public.delivery_signature (client_id, submission_id, order_id, salon_id, rep_id, device_hash, outcome,
      signatory_name, signatory_designation, statement_version, statement_text, lines_hash, signature_size, signature_hash,
      evidence_hash, note, signed_at)
  values (p_client_id, null, o.id, o.salon_id, auth.uid(), v_dev, p_outcome,
      case when p_outcome = 'signed' then btrim(p_name) end, case when p_outcome = 'signed' then btrim(p_designation) end,
      (st ->> 'version')::integer, st ->> 'text', v_lh, case when v_png is not null then length(v_png) end, v_hash,
      encode(sha256(convert_to(v_lh || '|' || p_outcome || '|' || coalesce(btrim(p_name), '') || '|' || coalesce(btrim(p_designation), '')
        || '|' || (st ->> 'version') || '|' || coalesce(v_hash, '') || '|' || v_dev || '|' || v_now::text, 'utf8')), 'hex'),
      case when p_outcome <> 'signed' then btrim(p_note) end, v_now)
  returning * into sg;
  if v_png is not null then insert into public.delivery_signature_image (signature_id, png) values (sg.id, v_png); end if;
  return jsonb_build_object('id', sg.id, 'outcome', sg.outcome, 'signed_at', sg.signed_at);
end $$;

-- Whether an order that waits for the office to deliver it has an unused signed acknowledgement of everything still to
-- deliver (the common case), and by whom.
create function app.office_order_signature(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.sales_order; v_hash text; sg public.delivery_signature;
begin
  perform app.assert_office();
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  select app.delivery_lines_hash(o.salon_id, o.id, coalesce(jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.remaining)), '[]'::jsonb))
    into v_hash from app.order_lines_left(o.id) x where x.remaining > 0;
  select g.* into sg from public.delivery_signature g
   where g.order_id = o.id and g.submission_id is null and g.outcome = 'signed' and g.lines_hash = v_hash
     and not exists (select 1 from public.delivery_signature_use u where u.signature_id = g.id)
   order by g.signed_at desc, g.id limit 1;
  return jsonb_build_object('covers_everything_left', sg.id is not null, 'signature_id', sg.id,
                            'signatory_name', sg.signatory_name, 'signatory_designation', sg.signatory_designation, 'signed_at', sg.signed_at);
end $$;

-- THE RULE. A delivery is final only with the salon's signed acknowledgement of exactly the goods delivered, plus the
-- office's approval. The approval is the act that reaches this insert; this AFTER INSERT trigger (so the invoice's own
-- checks answer first; it sorts after invoice_installments and before invoice_snapshot_write) refuses the invoice (and with it the
-- whole transaction: the delivery, the sale movement, the order status) unless an unused signed acknowledgement of
-- these exact goods exists, taken for the rep's pending submission or, for a rep-less order, by the office. It applies
-- to every path an API caller can use (an API caller always has a user id). A refusal to sign, an inability, or a
-- signature for different goods does not count.
create function control.invoice_signature_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d     public.delivery;
  v_h   text;
  v_sub uuid;
  v_sig uuid;
begin
  if auth.uid() is null then return null; end if;               -- not an API caller (a migration or a fixture)
  select * into d from public.delivery where id = new.delivery_id;
  select app.delivery_lines_hash(d.salon_id, d.order_id, coalesce(jsonb_agg(jsonb_build_object('sku_id', t.sku_id, 'qty', t.qty)), '[]'::jsonb))
    into v_h from (select dl.sku_id, sum(dl.qty)::integer qty from public.delivery_line dl where dl.delivery_id = d.id group by dl.sku_id) t;
  -- A rep's delivery is the order's one undecided submission with exactly these goods.
  select s.id into v_sub from public.delivery_submission s
   where s.order_id = d.order_id and app.submission_lines_hash(s.id) = v_h
     and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)
   limit 1;
  select g.id into v_sig from public.delivery_signature g
   where g.order_id = d.order_id and g.outcome = 'signed' and g.lines_hash = v_h
     and g.submission_id is not distinct from v_sub
     and not exists (select 1 from public.delivery_signature_use u where u.signature_id = g.id)
   order by g.signed_at desc, g.id limit 1;
  if v_sig is null then
    raise exception using errcode = '55000',
      message = 'a delivery is final only with the salon''s signed acknowledgement of exactly these goods and the office''s approval (D-49)';
  end if;
  insert into public.delivery_signature_use (signature_id, delivery_id) values (v_sig, d.id);
  return null;
end $$;
create trigger invoice_signature_gate after insert on public.invoice
  for each row execute function control.invoice_signature_gate();

-- ------------------------------------------------------------- the document ---
-- The builder: the invoice as the records say now, in the version 2 shape (the keys of version 1 are all kept). No
-- caller check; the callers below do it. Used at issue (to write the snapshot) and for any invoice without one.
create function app.invoice_document_live(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i      public.invoice;
  d      public.delivery;
  s      public.salon;
  dr     public.invoice_draft_version;
  v_area text;
  v_plan text;
  v_fy   integer;
  v_cname text; v_cphone text;
  v_officer text; v_deliverer text;
begin
  select * into i from public.invoice where id = p_invoice_id;
  if i.id is null then return null; end if;
  select * into d from public.delivery where id = i.delivery_id;
  select * into s from public.salon where id = i.salon_id;
  select a.name into v_area from public.area a where a.id = s.area_id;
  select t ->> 'name' into v_plan
  from public.app_config c, jsonb_array_elements(c.value) t
  where c.key = 'plan.templates' and t ->> 'code' = i.plan::text;
  select c.name, c.phone into v_cname, v_cphone from public.salon_contact c where c.salon_id = s.id and c.is_primary and c.active limit 1;
  select u.full_name into v_officer from public.user_profile u where u.id = i.commission_rep_id;
  select u.full_name into v_deliverer from public.user_profile u where u.id = i.delivered_by;
  select * into dr from public.invoice_draft_version where order_id = i.order_id order by version desc limit 1;
  v_fy := substring(i.number from 5 for 2)::integer;               -- INV-27-000001: the number carries its financial year
  return jsonb_build_object(
    'version', 2,
    'status', 'issued',
    'number', i.number,
    'financial_year', (2000 + v_fy - 1)::text || '-' || lpad(v_fy::text, 2, '0'),
    'issued_at', i.issued_at,
    'issue_date', (i.issued_at at time zone 'Asia/Karachi')::date,
    'order_reference', upper(left(i.order_id::text, 8)),
    'company', coalesce((select c.value from public.app_config c where c.key = 'company.profile'), '{}'::jsonb),
    'bank_accounts', coalesce((select c.value from public.app_config c where c.key = 'company.bank_accounts'), '[]'::jsonb),
    'salon', jsonb_build_object('name', s.name, 'address', s.address, 'area', v_area),
    'customer', jsonb_build_object('reference', upper(left(s.id::text, 8)), 'name', s.name, 'contact_person', v_cname,
                                   'telephone', v_cphone, 'billing_address', s.address, 'area', v_area),
    'sales_officer', v_officer,
    'delivery_person', v_deliverer,
    'delivery', jsonb_build_object('delivered_at', d.delivered_at, 'received_by_name', d.received_by_name, 'status', d.status),
    'plan', jsonb_build_object('code', i.plan, 'name', v_plan),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_no', ol.line_no, 'sku_id', k.id, 'sku_code', k.code, 'product', p.brand_label || ' ' || p.name,
               'variant', k.variant,
               'description', coalesce(nullif(btrim(dr.line_text ->> k.id::text), ''), p.brand_label || ' ' || p.name || ' ' || k.variant),
               'uom', case when k.size_value is not null
                           then trim(trailing '.' from trim(trailing '0' from k.size_value::text)) || ' ' || k.unit else k.unit end,
               'expiry', null,
               'qty', dl.qty, 'list_price_paisa', dl.list_price_paisa,
               'unit_price_paisa', dl.unit_price_paisa,
               'discount_paisa', (dl.list_price_paisa - dl.unit_price_paisa) * dl.qty,
               'gross_paisa', dl.list_price_paisa * dl.qty,
               'line_total_paisa', dl.line_total_paisa)
             order by ol.line_no)
      from public.delivery_line dl
      join public.sales_order_line ol on ol.id = dl.order_line_id
      join public.sku k on k.id = dl.sku_id
      join public.product p on p.id = k.product_id
      where dl.delivery_id = d.id), '[]'::jsonb),
    'totals', jsonb_build_object('subtotal_paisa', i.subtotal_paisa, 'discount_paisa', i.discount_paisa, 'total_paisa', i.total_paisa),
    'total_qty', coalesce((select sum(dl.qty) from public.delivery_line dl where dl.delivery_id = d.id), 0),
    'notes', dr.notes,
    'payment_instructions', dr.payment_instructions,
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
               'no', x.seq, 'of', x.of_count, 'due_on', x.due_on, 'pct', x.pct_of_total, 'amount_paisa', x.amount_due_paisa)
             order by x.seq)
      from public.installment x where x.invoice_id = i.id), '[]'::jsonb),
    'notices', jsonb_build_array(
      jsonb_build_object('code', 'no_paper_receipts',
        'en', 'Only the numbered receipt the system sends to your registered phone is valid. A paper receipt is not valid.',
        'ur', 'صرف وہ نمبر والی رسید درست ہے جو سسٹم آپ کے رجسٹرڈ فون پر بھیجتا ہے۔ کاغذی رسید درست نہیں۔'),
      jsonb_build_object('code', 'official_accounts_only',
        'en', 'Pay only into the company accounts printed on this invoice. Never pay a rep''s personal account or wallet.',
        'ur', 'ادائیگی صرف اس انوائس پر چھپے کمپنی کے اکاؤنٹس میں کریں۔ کسی ریپ کے ذاتی اکاؤنٹ یا والٹ میں ہرگز نہیں۔')));
end $$;

-- The part of an invoice that moves after issue: payments (and the fixed acknowledgement). Never snapshotted.
create function app.invoice_payments_overlay(p_invoice_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    -- The acknowledgement that made this invoice's delivery final (the rule: there is always one). It is fixed once used.
    'acknowledgement', (
      select jsonb_build_object('signature_id', g.id, 'outcome', g.outcome, 'signatory_name', g.signatory_name,
                                'signatory_designation', g.signatory_designation, 'signed_at', g.signed_at,
                                'statement_version', g.statement_version, 'matches_delivery', true)
      from public.invoice i
      join public.delivery_signature_use u on u.delivery_id = i.delivery_id
      join public.delivery_signature g on g.id = u.signature_id
      where i.id = p_invoice_id),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object('number', r.number, 'issued_at', r.issued_at, 'amount_paisa', t.amt)
                       order by r.issued_at, r.number)
      from (select a.payment_id, sum(a.amount_paisa)::bigint amt
            from public.payment_allocation a join public.installment x on x.id = a.installment_id
            where x.invoice_id = p_invoice_id group by a.payment_id) t
      join public.receipt r on r.payment_id = t.payment_id), '[]'::jsonb),
    'paid_paisa', coalesce((select sum(a.amount_paisa) from public.payment_allocation a join public.installment x on x.id = a.installment_id
                            where x.invoice_id = p_invoice_id), 0)::bigint,
    'outstanding_paisa', greatest(0, (select i.total_paisa from public.invoice i where i.id = p_invoice_id)
                            - coalesce((select sum(a.amount_paisa) from public.payment_allocation a join public.installment x on x.id = a.installment_id
                                        where x.invoice_id = p_invoice_id), 0))::bigint);
$$;

-- The trigger that writes the snapshot. It is an ordinary AFTER INSERT row trigger named to sort after
-- invoice_installments (triggers of one event fire in name order), so the delivery, its lines and the installments all
-- exist when it runs, and finalise_delivery needs no change.
create function control.write_invoice_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := app.invoice_document_live(new.id);
  if v is not null and not exists (select 1 from public.invoice_snapshot where invoice_id = new.id) then
    insert into public.invoice_snapshot (invoice_id, document, doc_hash)
    values (new.id, v, encode(sha256(convert_to(v::text, 'utf8')), 'hex'));
  end if;
  return null;
end $$;
create trigger invoice_snapshot_write after insert on public.invoice
  for each row execute function control.write_invoice_snapshot();

-- Invoices issued before this migration: their snapshot is what the records say now.
insert into public.invoice_snapshot (invoice_id, document, doc_hash)
select i.id, d.v, encode(sha256(convert_to(d.v::text, 'utf8')), 'hex')
from public.invoice i cross join lateral (select app.invoice_document_live(i.id) v) d
where d.v is not null and not exists (select 1 from public.invoice_snapshot z where z.invoice_id = i.id);

-- app.invoice_document: the snapshot plus the payments that moved since. Same access as before (office, or the
-- invoice's own rep on an approved phone); null otherwise.
create or replace function app.invoice_document(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.invoice; z public.invoice_snapshot;
begin
  select * into i from public.invoice where id = p_invoice_id;
  if i.id is null then return null; end if;
  if not (app.is_office() or coalesce(app.user_role() = 'rep' and i.rep_id = auth.uid() and app.self_ok(), false)) then
    return null;
  end if;
  select * into z from public.invoice_snapshot where invoice_id = i.id;
  if z.invoice_id is null then return app.invoice_document_live(i.id) || app.invoice_payments_overlay(i.id); end if;
  return z.document || app.invoice_payments_overlay(i.id);
end $$;

-- ------------------------------------------------------------ the composer ---
create function app.office_save_invoice_draft(
  p_client_id uuid, p_order_id uuid, p_notes text, p_payment_instructions text, p_line_text jsonb)
returns public.invoice_draft_version
language plpgsql security definer set search_path = '' as $$
declare
  v public.invoice_draft_version;
  o public.sales_order;
  v_line jsonb := coalesce(p_line_text, '{}'::jsonb);
  k text;
  n integer;
begin
  perform app.assert_office();
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a draft needs a client_id (idempotency key, H-08)';
  end if;
  select * into v from public.invoice_draft_version where client_id = p_client_id;
  if v.id is not null then
    if v.order_id = p_order_id then return v; end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into o from public.sales_order where id = p_order_id for update;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if o.status not in ('confirmed', 'partially_delivered') then
    raise exception using errcode = '55000', message = 'invoice text can be prepared for an order that is waiting to be delivered';
  end if;
  if jsonb_typeof(v_line) <> 'object' then
    raise exception using errcode = '22023', message = 'product descriptions must be a list of SKU and text';
  end if;
  if length(coalesce(p_notes, '')) > 500 or length(coalesce(p_payment_instructions, '')) > 500 then
    raise exception using errcode = '22023', message = 'notes and payment instructions are at most 500 characters';
  end if;
  for k in select jsonb_object_keys(v_line) loop
    if jsonb_typeof(v_line -> k) <> 'string' or length(btrim(v_line ->> k)) > 120 then
      raise exception using errcode = '22023', message = 'each product description is at most 120 characters';
    end if;
    if not exists (select 1 from public.sales_order_line l where l.order_id = o.id and l.sku_id::text = k) then
      raise exception using errcode = '22023', message = 'a description can be set only for a product on this order';
    end if;
  end loop;
  select coalesce(max(version), 0) + 1 into n from public.invoice_draft_version where order_id = o.id;
  perform app.set_purpose('invoice text prepared');
  insert into public.invoice_draft_version (client_id, order_id, version, notes, payment_instructions, line_text, saved_by)
  values (p_client_id, o.id, n, nullif(btrim(p_notes), ''), nullif(btrim(p_payment_instructions), ''), v_line, auth.uid())
  returning * into v;
  return v;
end $$;

-- The draft: the invoice as it would be issued now. Marked a draft, no number, nothing posted.
-- With p_submission_id: the rep's submitted quantities; otherwise everything still to deliver.
create function app.office_invoice_preview(p_order_id uuid, p_submission_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  o   public.sales_order;
  s   public.salon;
  sub public.delivery_submission;
  dr  public.invoice_draft_version;
  v_area text; v_cname text; v_cphone text; v_officer text; v_deliverer text; v_plan text;
  v_lines jsonb; v_sub bigint; v_tot bigint; v_qty bigint;
begin
  perform app.assert_office();
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if p_submission_id is not null then
    select * into sub from public.delivery_submission where id = p_submission_id and order_id = o.id;
    if sub.id is null then raise exception using errcode = '22023', message = 'that submission does not belong to this order'; end if;
  end if;
  select * into s from public.salon where id = o.salon_id;
  select a.name into v_area from public.area a where a.id = s.area_id;
  select c.name, c.phone into v_cname, v_cphone from public.salon_contact c where c.salon_id = s.id and c.is_primary and c.active limit 1;
  select u.full_name into v_officer from public.user_profile u where u.id = o.assigned_rep_id;
  select u.full_name into v_deliverer from public.user_profile u where u.id = sub.rep_id;
  select t ->> 'name' into v_plan from public.app_config c, jsonb_array_elements(c.value) t
   where c.key = 'plan.templates' and t ->> 'code' = o.plan::text;
  select * into dr from public.invoice_draft_version where order_id = o.id order by version desc limit 1;
  with picked as (
    select x.line_no, x.sku_id, x.list_price_paisa, x.unit_price_paisa,
           case when sub.id is null then x.remaining
                else coalesce((select (e ->> 'qty')::integer from jsonb_array_elements(sub.lines) e where (e ->> 'sku_id')::uuid = x.sku_id), 0) end as qty
    from app.order_lines_left(o.id) x)
  select jsonb_agg(jsonb_build_object(
           'line_no', q.line_no, 'sku_id', k.id, 'sku_code', k.code, 'product', p.brand_label || ' ' || p.name, 'variant', k.variant,
           'description', coalesce(nullif(btrim(dr.line_text ->> k.id::text), ''), p.brand_label || ' ' || p.name || ' ' || k.variant),
           'uom', case when k.size_value is not null
                       then trim(trailing '.' from trim(trailing '0' from k.size_value::text)) || ' ' || k.unit else k.unit end,
           'expiry', null, 'qty', q.qty, 'list_price_paisa', q.list_price_paisa, 'unit_price_paisa', q.unit_price_paisa,
           'discount_paisa', (q.list_price_paisa - q.unit_price_paisa) * q.qty, 'gross_paisa', q.list_price_paisa * q.qty,
           'line_total_paisa', q.unit_price_paisa * q.qty) order by q.line_no),
         coalesce(sum(q.qty::bigint * q.list_price_paisa), 0), coalesce(sum(q.qty::bigint * q.unit_price_paisa), 0), coalesce(sum(q.qty), 0)
    into v_lines, v_sub, v_tot, v_qty
  from picked q join public.sku k on k.id = q.sku_id join public.product p on p.id = k.product_id where q.qty > 0;
  return jsonb_build_object(
    'version', 2, 'status', 'draft', 'banner', 'DRAFT — NOT AN OFFICIAL INVOICE',
    'order_id', o.id, 'order_reference', upper(left(o.id::text, 8)), 'submission_id', sub.id,
    'company', coalesce((select c.value from public.app_config c where c.key = 'company.profile'), '{}'::jsonb),
    'bank_accounts', coalesce((select c.value from public.app_config c where c.key = 'company.bank_accounts'), '[]'::jsonb),
    'customer', jsonb_build_object('reference', upper(left(s.id::text, 8)), 'name', s.name, 'contact_person', v_cname,
                                   'telephone', v_cphone, 'billing_address', s.address, 'area', v_area),
    'sales_officer', v_officer, 'delivery_person', v_deliverer,
    'plan', jsonb_build_object('code', o.plan, 'name', v_plan),
    'lines', coalesce(v_lines, '[]'::jsonb),
    'totals', jsonb_build_object('subtotal_paisa', v_sub, 'discount_paisa', v_sub - v_tot, 'total_paisa', v_tot),
    'total_qty', v_qty,
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('no', x.inst_no, 'of', x.inst_count, 'due_on', x.due_on,
                                                              'pct', x.pct_of_total, 'amount_paisa', x.amount_paisa) order by x.inst_no)
                          from app.plan_schedule(o.plan, v_tot, app.karachi_today()) x where v_tot > 0), '[]'::jsonb),
    'notes', dr.notes, 'payment_instructions', dr.payment_instructions, 'draft_version', dr.version,
    'notices', jsonb_build_array(jsonb_build_object('code', 'no_paper_receipts',
      'en', 'Only the numbered receipt the system sends to your registered phone is valid. A paper receipt is not valid.')));
end $$;

-- ------------------------------------------------------------- the salon ----
-- A salon lists and opens its own issued invoices only (the salon is the caller's active membership, never an argument).
create function app.salon_my_invoices()
returns table (invoice_id uuid, number text, issued_at timestamptz, total_paisa bigint, paid_paisa bigint, outstanding_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select i.id, i.number, i.issued_at, i.total_paisa,
         (app.invoice_payments_overlay(i.id) ->> 'paid_paisa')::bigint, (app.invoice_payments_overlay(i.id) ->> 'outstanding_paisa')::bigint
  from public.invoice i where i.salon_id = v_salon order by i.issued_at desc, i.id limit 50;
end $$;

create function app.salon_invoice_document(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member(); i public.invoice; z public.invoice_snapshot;
begin
  select * into i from public.invoice where id = p_invoice_id and salon_id = v_salon;
  if i.id is null then return null; end if;
  select * into z from public.invoice_snapshot where invoice_id = i.id;
  return coalesce(z.document, app.invoice_document_live(i.id)) || app.invoice_payments_overlay(i.id);
end $$;

-- --------------------------------------------------------------- privileges ---
revoke execute on function
  app.delivery_ack_statement(), app.submission_lines_hash(uuid), app.delivery_lines_hash(uuid, uuid, jsonb), app.invoice_document_live(uuid),
  app.invoice_payments_overlay(uuid), control.write_invoice_snapshot(), control.invoice_signature_gate()
  from public, anon, authenticated, service_role;
revoke execute on function
  app.delivery_ack_text(), app.rep_attach_signature(uuid, uuid, text, text, text, text, text), app.my_signature_status(uuid),
  app.office_delivery_signature(uuid), app.office_signature_image(uuid, text),
  app.office_attach_signature(uuid, uuid, jsonb, text, text, text, text, text), app.office_order_signature(uuid),
  app.office_save_invoice_draft(uuid, uuid, text, text, jsonb), app.office_invoice_preview(uuid, uuid),
  app.salon_my_invoices(), app.salon_invoice_document(uuid)
  from public, anon;
grant execute on function
  app.delivery_ack_text(), app.rep_attach_signature(uuid, uuid, text, text, text, text, text), app.my_signature_status(uuid),
  app.office_delivery_signature(uuid), app.office_signature_image(uuid, text),
  app.office_attach_signature(uuid, uuid, jsonb, text, text, text, text, text), app.office_order_signature(uuid),
  app.office_save_invoice_draft(uuid, uuid, text, text, jsonb), app.office_invoice_preview(uuid, uuid),
  app.salon_my_invoices(), app.salon_invoice_document(uuid)
  to authenticated;
