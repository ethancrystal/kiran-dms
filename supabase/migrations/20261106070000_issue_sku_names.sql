-- REP-14, L1: a deactivated SKU showed as "Unknown SKU" on the rep's incoming-stock page.
--
-- The rep sees only active SKUs under RLS (sku_select), but the office may deactivate a SKU while a
-- stock issue that names it is still waiting for the rep's count. The rep must still see which product
-- to count. app.my_bag already names inactive SKUs (it runs as definer); this is the same for the
-- pending issue lines.
--
-- app.my_issue_skus(): the id, code and variant of every SKU named in a PENDING stock issue of the
-- caller's own bag (active or not), and nothing else: not the issue's quantities (the count stays blind,
-- CTL-05), no price, no other SKU. A rep on an approved phone only: self_ok() and the caller's own bag.
-- The office reads the sku table directly (sku_select shows it every row), so it is not given this.
--
-- Forward-only. No table, policy or other function changes.

create function app.my_issue_skus() returns table (sku_id uuid, code text, variant text)
language sql stable security definer set search_path = '' as $$
  select distinct k.id, k.code, k.variant
  from public.stock_issue i
  cross join lateral jsonb_array_elements(i.lines) e
  join public.sku k on k.id = (e ->> 'sku_id')::uuid
  where i.status = 'pending'
    and app.self_ok()
    and i.bag_id = app.my_bag_id()
$$;

revoke all on function app.my_issue_skus() from public, anon, authenticated, service_role;
grant execute on function app.my_issue_skus() to authenticated;

comment on function app.my_issue_skus() is
  'REP-14 (L1). The id, code and variant of the SKUs named in the pending stock issues of the rep''s own bag, active or not; no quantity, no price. A rep on an approved phone.';
