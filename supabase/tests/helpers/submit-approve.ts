/**
 * A rep's delivery the D-32 way, as one SQL script: the rep submits it (app.rep_submit_delivery, the
 * goods move from the bag to the rep's pending location) and an office user approves it
 * (app.office_approve_delivery, which writes the delivery, the sale out of pending, the invoice and
 * its installments, and moves the order on). Migration 20261105130100, completion slice 4 (P1-21).
 *
 * The same uuid is the submission's and the decision's client_id, and the delivery the approval
 * writes takes the submission's client_id, so a fixture that reads `delivery where client_id = <id>`
 * keeps working, and running the script twice replays both calls (one submission, one delivery, one
 * invoice). The last statement returns the invoice row (or the columns named in `returning`), as
 * app.rep_deliver did, so a fixture runs it as one ["postgres", sql] step and keeps its assertions.
 *
 * A refusal of the submission (wrong rep, no open day, bad input, short bag) fails the script at the
 * submission with the same SQLSTATE and words app.rep_deliver used, before the approval runs.
 */
const DEFAULT_RECEIVER = "Ayesha at the counter";
// P1-31 (D-49, MJ 2026-11-05): a delivery is final only with the salon's signed acknowledgement of exactly the goods and
// the office's approval, so every fixture that gets an invoice through the API signs first. A PNG signature plus zeros: the
// database checks the signature bytes and the size, not the drawing.
const PNG_HEADER = "89504e470d0a1a0a";
const PNG_PADDING_BYTES = 300;
export const SIGNATURE_PNG_BASE64 = Buffer.from(PNG_HEADER + "00".repeat(PNG_PADDING_BYTES), "hex").toString("base64");
/** The rep's signed acknowledgement of the submission whose client_id is given (replay-safe: its key is derived). */
export const signSubmissionSql = (submissionClientId: string, signatory = "Ayesha Khan", role = "Owner") =>
  `select app.rep_attach_signature(md5('sig-${submissionClientId}')::uuid, (select id from public.delivery_submission where client_id = '${submissionClientId}'), 'signed', '${signatory}', '${role}', '${SIGNATURE_PNG_BASE64}', null);`;
/** The office's signed acknowledgement of everything still to deliver on an order, before app.office_deliver. */
export const signOrderSql = (key: string, orderExpr: string, linesSql = "null", signatory = "Ayesha Khan", role = "Owner") =>
  `select app.office_attach_signature(md5('osig-${key}')::uuid, ${orderExpr}, ${linesSql}, 'signed', '${signatory}', '${role}', '${SIGNATURE_PNG_BASE64}', null);`;
const DEFAULT_LAT = 24.9;
const DEFAULT_LNG = 67.1;

export interface SubmitApproveArgs<K extends string> {
  /** The submission's client_id, reused as the approval's. */
  clientId: string;
  /** SQL for the order id: a literal or a subquery the rep can evaluate. */
  orderExpr: string;
  rep: K;
  approver: K;
  name?: string;
  /** SQL for the lines (jsonb), or null for everything left. */
  lines?: string | null;
  /** Extra arguments after the lines, starting with a comma (mock location, client time). */
  extra?: string;
  /** What the last statement selects from the invoice row; default every column. */
  returning?: string;
}

export const submitApproveSql = <K extends string>(asUser: (who: K) => string, a: SubmitApproveArgs<K>): string => `
  ${asUser(a.rep)}
  select app.rep_submit_delivery('${a.clientId}', ${a.orderExpr}, '${a.name ?? DEFAULT_RECEIVER}', ${DEFAULT_LAT}, ${DEFAULT_LNG}, ${
    a.lines ?? "null"
  }${a.extra ?? ""});
  ${signSubmissionSql(a.clientId)}
  ${asUser(a.approver)}
  select (app.office_approve_delivery((select id from public.delivery_submission where client_id = '${a.clientId}'), '${a.clientId}')).${
    a.returning ?? "*"
  };`;
