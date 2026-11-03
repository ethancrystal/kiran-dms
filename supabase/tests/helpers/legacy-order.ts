/**
 * A legacy rep_visit order, written directly as postgres.
 *
 * The rep path app.create_order is closed (D-30: orders are made in the office; it refuses every
 * caller), but orders it made before then still exist and keep their shape: source_channel rep_visit,
 * the rep's own rep_id, the rep's day, created_by = rep_id, no assigned rep. Their rep still reads,
 * delivers, rechecks and cancels its own draft of them. A test whose subject is that legacy shape or
 * the rep's ownership of it builds one here instead of calling the closed function. Tests that only
 * need an order to deliver, pay or hand over use app.office_create_order with the rep assigned (see
 * deliveries.test.ts).
 *
 * The row is what app.create_order left after its checks: one line at list price, no discount,
 * total = subtotal. By default it is confirmed (the credit check passed); with status "draft" it is
 * held by the credit check (hold_credit, no confirmed_at), as the rep path left an order over a limit.
 * It meets sales_order_total, sales_order_confirmed, sales_order_confirmed_clear and
 * sales_order_channel_shape. Run the returned SQL as postgres; the rep needs an open rep_day (status open) today
 * (the caller's prelude opens it). Without one the SQL raises at once instead of inserting nothing.
 */
const TODAY_KARACHI = "(now() at time zone 'Asia/Karachi')::date";
const FIRST_LINE_NO = 1;
const NO_DISCOUNT = 0;

export type LegacyStatus = "confirmed" | "draft";
export type LegacyHold = "blocked" | "plan_not_allowed" | "over_limit";

export interface LegacyOrderArgs {
  clientId: string;
  salonId: string;
  skuId: string;
  qty: number;
  /** List price per unit in paisa; the line is sold at list, so there is no discount. */
  unitPaisa: number;
  repId: string;
  plan: string;
  /** Default "confirmed". A "draft" is held by the credit check with `hold`. */
  status?: LegacyStatus;
  /** The credit hold of a draft; default over_limit. Ignored for a confirmed order. */
  hold?: LegacyHold;
  /**
   * Default true. When false the insert names neither source_channel nor created_by, as migration
   * 0012's rep path wrote its rows: the column default (rep_visit) and the sales_order_creator trigger
   * (created_by := rep_id) fill them in, so a test can prove those two still do.
   */
  namesChannelAndCreator?: boolean;
}

const sqlText = (v: string | null) => (v === null ? "null" : `'${v}'`);

export const legacyOrderSql = (a: LegacyOrderArgs): string => {
  const total = a.qty * a.unitPaisa;
  const draft = a.status === "draft";
  const named = a.namesChannelAndCreator ?? true;
  const channelCols = named ? "source_channel, created_by, " : "";
  const channelVals = named ? `'rep_visit', '${a.repId}', ` : "";
  return `
  do $legacy$ begin
    if not exists (select 1 from public.rep_day d where d.rep_id = '${a.repId}' and d.day = ${TODAY_KARACHI} and d.status = 'open') then
      raise exception 'legacyOrderSql: rep ${a.repId} has no open rep day today; open it before building a legacy order';
    end if;
  end $legacy$;
  with day as (
    select d.id from public.rep_day d where d.rep_id = '${a.repId}' and d.day = ${TODAY_KARACHI} and d.status = 'open'
  ), made as (
    insert into public.sales_order (id, client_id, salon_id, ${channelCols}rep_id, rep_day_id, plan, delivery_mode,
                                     status, subtotal_paisa, discount_paisa, total_paisa, hold_credit, confirmed_at)
    select '${a.clientId}', '${a.clientId}', '${a.salonId}', ${channelVals}'${a.repId}', day.id, '${a.plan}', 'bag_now',
           '${draft ? "draft" : "confirmed"}', ${total}, ${NO_DISCOUNT}, ${total}, ${sqlText(draft ? (a.hold ?? "over_limit") : null)},
           ${draft ? "null" : "now()"}
      from day
    returning id
  )
  insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select made.id, ${FIRST_LINE_NO}, '${a.skuId}', ${a.qty}, ${a.unitPaisa}, ${a.unitPaisa}, ${total} from made;`;
};
