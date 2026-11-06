// The invoice and receipt documents (F6), as app.invoice_document and app.receipt_document return them,
// and the lists of app.office_invoices and app.office_receipts. Every figure is the database's: pages
// format it and add nothing up. The documents are English only (MJ, 2026-11-05, doc 08): a page prints
// each notice's `en` text and the company's English name, never the Urdu the functions still carry.

export const ONLY_VALID_PROOF = "The system receipt is the only valid proof of payment.";

export type Notice = { code: string; en: string };
export type Company = {
  name_en?: string;
  city?: string;
  // Optional keys of the company.profile setting; shown only when the owner has set them (P1-31, A-22).
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  tax_registration?: string;
  signatory_name?: string;
  signatory_title?: string;
};
export type Acknowledgement = {
  signature_id?: string;
  outcome: "signed" | "refused" | "unable";
  signatory_name: string | null;
  signatory_designation: string | null;
  signed_at: string;
  statement_version: number;
  matches_delivery: boolean;
};

export type InvoiceLine = {
  line_no: number;
  sku_id?: string;
  sku_code: string;
  product: string;
  variant: string | null;
  // Version 2 (P1-31): the customer-facing text, the unit, the expiry (null: not recorded), and the money split.
  description?: string;
  uom?: string;
  expiry?: string | null;
  qty: number;
  list_price_paisa?: number;
  unit_price_paisa: number;
  discount_paisa?: number;
  gross_paisa?: number;
  line_total_paisa: number;
};

export type InvoiceDocument = {
  version?: number;
  status?: "issued" | "draft";
  banner?: string;
  number: string;
  financial_year: string;
  issued_at?: string;
  issue_date?: string;
  order_reference?: string;
  company: Company;
  bank_accounts: Array<{ bank: string; account_title: string; account_no: string }>;
  salon: { name: string | null; address: string | null; area: string | null };
  customer?: {
    reference: string | null;
    name: string | null;
    contact_person: string | null;
    telephone: string | null;
    billing_address: string | null;
    area: string | null;
  };
  sales_officer?: string | null;
  delivery_person?: string | null;
  delivery: { delivered_at: string; received_by_name: string | null; status: string };
  plan: { code: string; name: string | null };
  lines: InvoiceLine[];
  totals: { subtotal_paisa: number; discount_paisa: number; total_paisa: number };
  total_qty?: number;
  notes?: string | null;
  payment_instructions?: string | null;
  acknowledgement?: Acknowledgement | null;
  paid_paisa?: number;
  outstanding_paisa?: number;
  schedule: Array<{ no: number; of: number; due_on: string; pct: number; amount_paisa: number }>;
  receipts: Array<{ number: string; issued_at: string; amount_paisa: number }>;
  notices: Notice[];
};

export type ReceiptDocument = {
  number: string;
  issued_at: string;
  company: Company;
  salon: { name: string | null };
  payment: {
    amount_paisa: number;
    method: string;
    bank_name: string | null;
    bank_reference: string | null;
    recorded_at: string;
  };
  allocations: Array<{ invoice_number: string; seq: number; of: number; amount_paisa: number }>;
  remaining: Array<{ invoice_number: string; seq: number; of: number; due_on: string; remaining_paisa: number }>;
  notices: Notice[];
  reversed?: { reversed_at: string; reason: string };
};

export type InvoiceRow = {
  invoice_id: string;
  number: string;
  issued_at: string;
  salon_id: string;
  salon_name: string | null;
  order_id: string;
  total_paisa: number;
  total_count: number;
};

export type ReceiptRow = {
  receipt_id: string;
  number: string;
  issued_at: string;
  salon_id: string;
  salon_name: string | null;
  method: string;
  amount_paisa: number;
  total_count: number;
};

/** A database date (YYYY-MM-DD) with its year, for a document or a history that may span years. */
export const fullDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** How a payment was made, in plain words. */
export const METHOD_TEXT: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer" };

// A uuid in a URL. "6f1c2d3e-0000-4000-8000-000000000000" matches; "abc" and "6f1c2d3e" do not.
// https://regex101.com/?regex=%5E%5B0-9a-f%5D%7B8%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B12%7D%24&flavor=javascript
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);
