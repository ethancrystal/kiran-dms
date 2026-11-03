/**
 * A confirmed legacy rep_visit order, written directly as postgres.
 *
 * The rep path app.create_order is retired (D-30: orders are made in the office), but orders it made
 * before then still exist and keep their shape: source_channel rep_visit, the rep's own rep_id, the
 * rep's open day, created_by = rep_id, no assigned rep. A test whose subject is that legacy shape
 * builds one here instead of calling the retired function. Tests that only need an order to deliver,
 * pay or hand over use app.office_create_order with the rep assigned (see deliveries.test.ts).
 *
 * The row is what app.create_order left after its checks passed with no credit hold and no discount:
 * status confirmed, one line at list price, total = subtotal. It meets sales_order_total,
 * sales_order_confirmed and sales_order_channel_shape. Run the returned SQL as postgres; the rep needs
 * an open day today (the caller's prelude opens it).
 */
const TODAY_KARACHI = "(now() at time zone 'Asia/Karachi')::date";
const FIRST_LINE_NO = 1;

export interface LegacyOrderArgs {
  clientId: string;
  salonId: string;
  skuId: string;
  qty: number;
  /** List price per unit in paisa; the line is sold at list, so there is no discount. */
  unitPaisa: number;
  repId: string;
  plan: string;
}

export const legacyOrderSql = (a: LegacyOrderArgs): string => {
  const total = a.qty * a.unitPaisa;
  return `
  with day as (
    select d.id from public.rep_day d where d.rep_id = '${a.repId}' and d.day = ${TODAY_KARACHI}
  ), made as (
    insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, rep_day_id, plan, delivery_mode,
                                     status, subtotal_paisa, discount_paisa, total_paisa, confirmed_at)
    select '${a.clientId}', '${a.clientId}', '${a.salonId}', 'rep_visit', '${a.repId}', '${a.repId}', day.id, '${a.plan}', 'bag_now',
           'confirmed', ${total}, 0, ${total}, now()
      from day
    returning id
  )
  insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select made.id, ${FIRST_LINE_NO}, '${a.skuId}', ${a.qty}, ${a.unitPaisa}, ${a.unitPaisa}, ${total} from made;`;
};
