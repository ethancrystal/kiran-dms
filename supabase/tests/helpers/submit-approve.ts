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
  ${asUser(a.approver)}
  select (app.office_approve_delivery((select id from public.delivery_submission where client_id = '${a.clientId}'), '${a.clientId}')).${
    a.returning ?? "*"
  };`;
