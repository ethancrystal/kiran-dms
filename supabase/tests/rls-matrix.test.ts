/**
 * RLS matrix (NFR-12, H-13, doc 06 §4 + §10.1): role × table × operation.
 *
 * Every table appears here with an expectation for every persona. Adding a table in a
 * migration without adding it to MATRIX fails `every table is covered by the matrix`.
 *
 * Reps on an unapproved device and suspended users see nothing (doc 04 invariant 7);
 * the app reads their status through app.my_session() instead.
 *
 * SELECT expectation: "denied" (no privilege) or a SQL predicate. The persona must see
 * exactly the rows the predicate selects (evaluated as postgres): the two sorted lists of
 * whole-row text are compared, so a policy showing other rows in the same number fails
 * (L-0116 D2). Writes: every
 * application role (anon, authenticated personas, service_role) must be refused for
 * direct INSERT / UPDATE / DELETE — all writes go through app.* functions (H-08).
 */
import { describe, expect, it } from "vitest";
import { fx, run, sqlstate, type Who, OWNER, OWNER_AAL1, MANAGER, MANAGER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED } from "./helpers/db";

type Sel = "denied" | string;
interface Row {
  table: string;
  writeCol: string;
  select: Record<string, Sel>;
}

const P: Record<string, Who> = {
  anon: "anon",
  repA: REP_A,
  repAWrongDevice: REP_A_WRONG_DEVICE,
  repB: REP_B,
  manager: MANAGER,
  managerAal1: MANAGER_AAL1,
  owner: OWNER,
  ownerAal1: OWNER_AAL1,
  suspended: SUSPENDED,
  service_role: "service_role",
};

const me = (k: keyof typeof fx) => `'${fx[k].id}'`;
// The persona's rep bag id as a scalar subquery (null when it has none: the predicate then selects nothing).
// The persona's current territory ids as a subquery.
const terr = (k: keyof typeof fx) =>
  `(select rt.territory_id from public.rep_territory rt where rt.rep_id = ${me(k)} and rt.to_date is null)`;
const bag = (k: keyof typeof fx) =>
  `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = ${me(k)})`;

const MATRIX: Row[] = [
  {
    table: "public.user_profile",
    writeCol: "full_name",
    select: {
      anon: "denied",
      repA: `id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `id = ${me("repB")}`,
      manager: "true",
      managerAal1: `id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.device",
    writeCol: "label",
    select: {
      anon: "denied",
      repA: `user_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `user_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `user_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `user_id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.app_config",
    writeCol: "note",
    select: {
      anon: "denied",
      repA: "rep_visible",
      repAWrongDevice: "false",
      repB: "rep_visible",
      manager: "true",
      // Without MFA an office user is treated like any active user: rep-visible lists only,
      // never governance values (credit rules, thresholds).
      managerAal1: "rep_visible",
      owner: "true",
      ownerAal1: "rep_visible",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "control.approval_request",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `maker_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `maker_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `maker_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `maker_id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "control.audit_event",
    writeCol: "purpose",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "false",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "denied",
    },
  },
  // Inventory (migration 0008, P1-04). Catalogue: active rows for any active user (reps on
  // their approved device); everything for AAL2 office users.
  ...(["public.product_group", "public.product", "public.sku"] as const).map((table): Row => ({
    table,
    writeCol: table === "public.sku" ? "variant" : "name",
    select: {
      anon: "denied",
      repA: "active",
      repAWrongDevice: "false",
      repB: "active",
      manager: "true",
      managerAal1: "active",
      owner: "true",
      ownerAal1: "active",
      suspended: "false",
      service_role: "true",
    },
  })),
  {
    table: "public.stock_location",
    writeCol: "name",
    select: {
      anon: "denied",
      repA: `owner_user_id = ${me("repA")} or (kind = 'warehouse' and active)`,
      repAWrongDevice: "false",
      repB: `owner_user_id = ${me("repB")} or (kind = 'warehouse' and active)`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.stock_movement",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `from_location_id = ${bag("repA")} or to_location_id = ${bag("repA")}`,
      repAWrongDevice: "false",
      repB: `from_location_id = ${bag("repB")} or to_location_id = ${bag("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.stock_issue",
    writeCol: "decision_note",
    select: {
      anon: "denied",
      repA: `bag_id = ${bag("repA")}`,
      repAWrongDevice: "false",
      repB: `bag_id = ${bag("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.stock_count",
    writeCol: "variance_units",
    select: {
      anon: "denied",
      repA: `counted_by = ${me("repA")} and kind = 'daily_close'`,
      repAWrongDevice: "false",
      repB: `counted_by = ${me("repB")} and kind = 'daily_close'`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.reorder_rule",
    writeCol: "reorder_point",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.demand_signal",
    writeCol: "qty",
    select: {
      anon: "denied",
      repA: `captured_by = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `captured_by = ${me("repB")}`,
      manager: "true",
      managerAal1: `captured_by = ${me("manager")}`,
      owner: "true",
      ownerAal1: `captured_by = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  // Territories and salons (migration 0009, P1-02 part a). Reps see their current
  // territories and areas; salon tables are office-only, reps read them through capped
  // functions (H-14).
  {
    table: "public.territory",
    writeCol: "name",
    select: {
      anon: "denied",
      repA: `id in ${terr("repA")}`,
      repAWrongDevice: "false",
      repB: `id in ${terr("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.area",
    writeCol: "name",
    select: {
      anon: "denied",
      repA: `territory_id in ${terr("repA")}`,
      repAWrongDevice: "false",
      repB: `territory_id in ${terr("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.rep_territory",
    writeCol: "to_date",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.salon",
    writeCol: "name",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.salon_contact",
    writeCol: "phone",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.salon_note",
    writeCol: "body",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.stage_event",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "control.phone_reveal",
    writeCol: "created_at",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "false",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "denied",
    },
  },
  // Rep day and visits (migration 0010, P1-02 part b). A rep sees its own days; visits are
  // salon data, office-only at the table (H-14).
  {
    table: "public.rep_day",
    writeCol: "close_reason",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.visit",
    writeCol: "notes",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Due-list and routes (migration 0011, P1-16). A rep sees its own route rows (a day, no salon
  // data); cycle estimates and stops are salon data, office-only at the table (H-14).
  {
    table: "public.cycle_estimate",
    writeCol: "last_order_on",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.route",
    writeCol: "day",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.route_stop",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Credit profile and orders (migration 0012, P1-06 part a). Credit is office-only at the table
  // (reps read app.salon_credit_status); a rep reads its own orders and their lines.
  {
    table: "public.salon_credit",
    writeCol: "credit_limit_paisa",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.credit_event",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Orders, their lines, deliveries and delivery lines: the order's rep or its assigned rep (migration
  // 20261104090000, D-30: an office order names the rep who delivers it in assigned_rep_id).
  {
    table: "public.sales_order",
    writeCol: "cancel_reason",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")} or assigned_rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")} or assigned_rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.sales_order_line",
    writeCol: "qty",
    select: {
      anon: "denied",
      repA: `order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repA")} or o.assigned_rep_id = ${me("repA")}))`,
      repAWrongDevice: "false",
      repB: `order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repB")} or o.assigned_rep_id = ${me("repB")}))`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Deliveries and invoices (migration 0013, P1-06 part b): a rep reads those of its own orders.
  {
    table: "public.delivery",
    writeCol: "received_by_name",
    select: {
      anon: "denied",
      repA: `order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repA")} or o.assigned_rep_id = ${me("repA")}))`,
      repAWrongDevice: "false",
      repB: `order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repB")} or o.assigned_rep_id = ${me("repB")}))`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.delivery_line",
    writeCol: "qty",
    select: {
      anon: "denied",
      repA: `delivery_id in (select d.id from public.delivery d where d.order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repA")} or o.assigned_rep_id = ${me("repA")})))`,
      repAWrongDevice: "false",
      repB: `delivery_id in (select d.id from public.delivery d where d.order_id in (select o.id from public.sales_order o where (o.rep_id = ${me("repB")} or o.assigned_rep_id = ${me("repB")})))`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.invoice",
    writeCol: "total_paisa",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Delivery submissions, their decisions and pending-stock settlements (migration 20261105130100,
  // slice 4, P1-21, D-32): the office reads all; a rep reads its own on its approved phone.
  {
    table: "public.delivery_submission",
    writeCol: "received_by_name",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  ...(["public.delivery_submission_decision", "public.pending_stock_resolution"] as const).map(
    (table): Row => ({
      table,
      writeCol: table === "public.delivery_submission_decision" ? "reason" : "note",
      select: {
        anon: "denied",
        repA: `submission_id in (select s.id from public.delivery_submission s where s.rep_id = ${me("repA")})`,
        repAWrongDevice: "false",
        repB: `submission_id in (select s.id from public.delivery_submission s where s.rep_id = ${me("repB")})`,
        manager: "true",
        managerAal1: "false",
        owner: "true",
        ownerAal1: "false",
        suspended: "false",
        service_role: "true",
      },
    }),
  ),
  // Money in (migration 0021, P1-07 part a): installments and allocations are office-only at the
  // table (reps read them through app.salon_installments); a rep reads its own payments, their
  // receipts and its own cash rows.
  {
    table: "public.installment",
    writeCol: "amount_due_paisa",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.payment_allocation",
    writeCol: "amount_paisa",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.payment",
    writeCol: "amount_paisa",
    select: {
      anon: "denied",
      repA: `recorded_by = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `recorded_by = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.receipt",
    writeCol: "number",
    select: {
      anon: "denied",
      repA: `payment_id in (select p.id from public.payment p where p.recorded_by = ${me("repA")})`,
      repAWrongDevice: "false",
      repB: `payment_id in (select p.id from public.payment p where p.recorded_by = ${me("repB")})`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.cash_ledger_entry",
    writeCol: "amount_paisa",
    select: {
      anon: "denied",
      repA: `holder_type = 'rep' and holder_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `holder_type = 'rep' and holder_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Cash handover (migration 0023, P1-07, PAY-05, CTL-03): the office reads all; a rep reads its own
  // handovers and the answers to them, on its approved phone.
  {
    table: "public.handover",
    writeCol: "counted_paisa",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.handover_response",
    writeCol: "note",
    select: {
      anon: "denied",
      repA: `handover_id in (select h.id from public.handover h where h.rep_id = ${me("repA")})`,
      repAWrongDevice: "false",
      repB: `handover_id in (select h.id from public.handover h where h.rep_id = ${me("repB")})`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Handover settlements (migration 20261105210000, P1-30, D-46): as the handover answers.
  {
    table: "public.handover_settlement",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `handover_id in (select h.id from public.handover h where h.rep_id = ${me("repA")})`,
      repAWrongDevice: "false",
      repB: `handover_id in (select h.id from public.handover h where h.rep_id = ${me("repB")})`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Payment reversals (migration 20261105210000, P1-30, D-48): as payments: the office reads all; a rep
  // reads the reversals of the payments it recorded, on its approved phone.
  {
    table: "public.payment_reversal",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `payment_id in (select p.id from public.payment p where p.recorded_by = ${me("repA")})`,
      repAWrongDevice: "false",
      repB: `payment_id in (select p.id from public.payment p where p.recorded_by = ${me("repB")})`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // The owner's own stock adjustments (migration 20261105210000, P1-30, D-45): office only.
  {
    table: "public.owner_stock_adjustment",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Order cards (D-30): a rep reads its own cards and their closes on its approved phone; the office reads all.
  {
    table: "public.order_intake_card",
    writeCol: "body",
    select: {
      anon: "denied",
      repA: `rep_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `rep_id = ${me("repB")}`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.order_intake_card_close",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `card_id in (select c.id from public.order_intake_card c where c.rep_id = ${me("repA")})`,
      repAWrongDevice: "false",
      repB: `card_id in (select c.id from public.order_intake_card c where c.rep_id = ${me("repB")})`,
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Request versions and lines (migration 20261105150000, slice 6, D-34): as the card itself, the office
  // reads all; a rep reads those of its own cards on its approved phone; a salon reads none of them (it
  // reads through app.salon_* only).
  ...(["public.order_intake_card_version", "public.order_intake_card_line"] as const).map(
    (table): Row => ({
      table,
      writeCol: table === "public.order_intake_card_version" ? "body" : "qty",
      select: {
        anon: "denied",
        repA: `card_id in (select c.id from public.order_intake_card c where c.rep_id = ${me("repA")})`,
        repAWrongDevice: "false",
        repB: `card_id in (select c.id from public.order_intake_card c where c.rep_id = ${me("repB")})`,
        manager: "true",
        managerAal1: "false",
        owner: "true",
        ownerAal1: "false",
        suspended: "false",
        service_role: "true",
      },
    }),
  ),
  // Invitations (migration 20261105100000, slice 1, D-39): no grant and no policy, so nobody reads the
  // table, not even the office (app.office_invitations lists it without the token hash). Memberships,
  // salon decisions and rep assignments: the office reads all; a rep or a salon reads none of them
  // (salons read through app.salon_me only, spec section 4).
  {
    table: "public.invitation",
    writeCol: "full_name",
    select: Object.fromEntries(Object.keys(P).map((k) => [k, "denied"])),
  },
  {
    table: "public.salon_membership",
    writeCol: "status_reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.salon_approval_decision",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.salon_rep_assignment",
    writeCol: "rate_bp",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "true",
    },
  },
  // Price history and per-salon prices (migration 20261105110000, slice 2, D-37, D-39): the office
  // reads both; no rep reads them (salons get their own prices through slice 6's functions).
  ...(["public.sku_price_change", "public.salon_sku_price"] as const).map(
    (table): Row => ({
      table,
      writeCol: "reason",
      select: {
        anon: "denied",
        repA: "false",
        repAWrongDevice: "false",
        repB: "false",
        manager: "true",
        managerAal1: "false",
        owner: "true",
        ownerAal1: "false",
        suspended: "false",
        service_role: "true",
      },
    }),
  ),
  // Investor ledger (migration 20261105120000, slice 3, D-40): the office reads all four tables; no rep,
  // AAL1 office session or anon reads any row, and there is no investor login.
  ...(["public.investor", "public.investment", "public.investor_profit_decision", "public.investor_payout"] as const).map(
    (table): Row => ({
      table,
      writeCol: table === "public.investor" ? "full_name" : "note",
      select: {
        anon: "denied",
        repA: "false",
        repAWrongDevice: "false",
        repB: "false",
        manager: "true",
        managerAal1: "false",
        owner: "true",
        ownerAal1: "false",
        suspended: "false",
        service_role: "true",
      },
    }),
  ),
  // Commission default rates and payments (migration 20261105140000, slice 5, P1-22, D-38): the office
  // reads all; a rep reads its own through app.my_commission only, and a salon reads nothing.
  ...(["public.rep_commission_rate", "public.commission_payment"] as const).map(
    (table): Row => ({
      table,
      writeCol: table === "public.rep_commission_rate" ? "rate_bp" : "amount_paisa",
      select: {
        anon: "denied",
        repA: "false",
        repAWrongDevice: "false",
        repB: "false",
        manager: "true",
        managerAal1: "false",
        owner: "true",
        ownerAal1: "false",
        suspended: "false",
        service_role: "true",
      },
    }),
  ),
  {
    table: "control.audit_chain_head",
    writeCol: "last_hash",
    select: Object.fromEntries(Object.keys(P).map((k) => [k, "denied"])),
  },
  {
    table: "control.doc_counter",
    writeCol: "last_no",
    select: Object.fromEntries(Object.keys(P).map((k) => [k, "denied"])),
  },
];

// The rows of a table that match a predicate, as a sorted list of whole-row text: row identity,
// not a count. Run as postgres with the expected predicate, and as the persona with `true`.
const rowSet = (table: string, where: string) =>
  `select coalesce(array_agg(t::text order by t::text), '{}') as rows from ${table} t where ${where}`;

// Every relation (table, view, materialized view, foreign table) in our five schemas.
const COVERAGE = `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname in ('public', 'control', 'supplier_vault', 'app', 'vault_api') order by 1`;

describe("RLS matrix", () => {
  it("every table, view, materialized view and foreign table in our five schemas is covered by the matrix", async () => {
    // Views and the API-exposed schemas app and vault_api count too: a view or a table there
    // would otherwise escape the role-by-role checks below (council finding 4, B-26).
    const { rows } = await run<{ t: string }>("postgres", COVERAGE);
    expect(rows.map((r) => r.t).sort()).toEqual(MATRIX.map((m) => m.table).sort());
  });

  it("the coverage query sees a planted view in an exposed schema and a planted table in public", async () => {
    const res = (await run("postgres", `create view app.zz_planted with (security_invoker = true) as select 1 as x;
      create table public.zz_planted_t (id int); ${COVERAGE}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
    const seen = res[res.length - 1].rows.map((r) => r.t);
    expect(seen).toContain("app.zz_planted");
    expect(seen).toContain("public.zz_planted_t");
  });

  it("the SELECT comparison catches a same-count leak: repA shown other users' devices instead of its own (L-0116 D2)", async () => {
    // One rolled-back transaction. A helper picks as many devices of OTHER users as repA owns, and
    // device_select is altered to show repA exactly those, so the count stays right whatever rows
    // other test files have committed. The expected set is taken as postgres, the visible set as repA.
    const A = fx.repA.id;
    const res = (await run("postgres", `
      create function public.zz_planted_swap() returns setof uuid language sql stable security definer set search_path = '' as $f$
        select d.id from public.device d where d.user_id <> '${A}'::uuid order by d.id
        limit (select count(*) from public.device where user_id = '${A}'::uuid) $f$;
      grant execute on function public.zz_planted_swap() to authenticated;
      alter policy device_select on public.device using (
        case when (select auth.uid()) = '${A}'::uuid then id in (select public.zz_planted_swap())
             else (user_id = (select auth.uid()) and (select app.self_ok())) or (select app.is_office()) end);
      ${rowSet("public.device", `(user_id = ${me("repA")})`)};
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: A, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;
      ${rowSet("public.device", "true")}`)) as unknown as Array<{ rows: Array<{ rows: string[] }> }>;
    const want = res[3].rows[0].rows, got = res[6].rows[0].rows;
    expect(want.length).toBeGreaterThan(0);
    expect(got.length).toBe(want.length);
    expect(got).not.toEqual(want);
  });

  for (const row of MATRIX) {
    describe(row.table, () => {
      for (const [name, who] of Object.entries(P)) {
        const exp = row.select[name];
        it(`${name} SELECT → ${exp === "denied" ? "denied" : `rows where ${exp}`}`, async () => {
          if (exp === "denied") {
            expect(await sqlstate(who, `select count(*) from ${row.table}`)).toBe("42501");
            return;
          }
          const want = await run<{ rows: string[] }>("postgres", rowSet(row.table, `(${exp})`));
          const got = await run<{ rows: string[] }>(who, rowSet(row.table, "true"));
          expect(got.rows[0].rows).toEqual(want.rows[0].rows);
        });

        for (const [op, sql] of [
          ["INSERT", `insert into ${row.table} default values`],
          ["UPDATE", `update ${row.table} set ${row.writeCol} = ${row.writeCol}`],
          ["DELETE", `delete from ${row.table}`],
        ] as const) {
          it(`${name} ${op} → denied`, async () => {
            expect(await sqlstate(who, sql)).toBe("42501");
          });
        }
      }
    });
  }
});
