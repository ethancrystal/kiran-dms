// Shared by the Approvals and Stock pages (slice 8, P1-25).
/** One row of app.office_pending_approvals (migration 20261105170000): allow-listed fields only. */
export type Approval = {
  request_id: string;
  kind: "discount" | "adjustment";
  status: "pending" | "approved";
  subject_type: string;
  subject_id: string;
  made_by_me: boolean;
  maker_name: string;
  checker_role_required: "manager" | "owner";
  reason: string;
  created_at: string;
  order_status: string | null;
  salon_id: string | null;
  salon_name: string | null;
  subtotal_paisa: number | null;
  discount_paisa: number | null;
  total_paisa: number | null;
  location_name: string | null;
  location_kind: string | null;
  sku_id: string | null;
  sku_code: string | null;
  qty_delta: number | null;
};

/** One row of app.office_refused_approvals (migration 20261105210000, P1-30): refused in the last 14 days. */
export type RefusedApproval = {
  request_id: string;
  kind: "discount" | "adjustment";
  made_by_me: boolean;
  maker_name: string;
  reason: string;
  created_at: string;
  salon_name: string | null;
  location_name: string | null;
  location_kind: string | null;
  sku_code: string | null;
  qty_delta: number | null;
  decided_at: string;
  checker_name: string | null;
  decision_reason: string;
};
