/**
 * One reminder pass (P1-38, MSG-03). The database decides who is due and records the round.
 * This module never looks up a phone or a price. Real mail stays off until MJ names a service (B-61):
 * the default adapter refuses to send and opens no network connection.
 */

export type ReminderClaim = {
  kind: string;
  item_id: string;
  round_no: number;
};

export type DueReminder = {
  recipient_id: string;
  body: string;
  claims: ReminderClaim[];
};

export type ReminderResult = "claimed" | "sent" | "not_configured";

export type MailAdapter = {
  readonly sends: boolean;
  send(to: string, body: string): Promise<void>;
};

export type ReminderJobDeps = {
  due: (now?: string) => Promise<DueReminder[]>;
  record: (recipientId: string, claims: ReminderClaim[], result: ReminderResult) => Promise<number>;
  addressOf: (recipientId: string) => Promise<string | null>;
  adapter: MailAdapter;
};

export type ReminderJobCounts = {
  sent: number;
  recorded: number;
  refused: number;
};

/** A rupee amount or a phone number must never leave in a reminder. A uuid of digits does not match. */
export const PRICE_PATTERN = /\b(?:rs\.?|paisa)\b|₹|\$\s*\d/i;
export const PHONE_PATTERN = /(?:\+92[\s-]?\d|\b03\d{9}\b|\b\d{11}\b)/;

export function bodyAllowed(body: string): boolean {
  return !PRICE_PATTERN.test(body) && !PHONE_PATTERN.test(body);
}

/** The adapter used until a mail service is named. Calling send is a mistake; the job must not call it. */
export function unconfiguredAdapter(): MailAdapter {
  return {
    sends: false,
    send(): Promise<void> {
      throw new Error("Mail is not configured.");
    },
  };
}

/** Records each message in memory. Tests use this. It does not open a network connection. */
export function fakeAdapter(sent: Array<{ to: string; body: string }> = []): MailAdapter {
  return {
    sends: true,
    async send(to: string, body: string): Promise<void> {
      sent.push({ to, body });
    },
  };
}

/**
 * Claim the round before any send. A second pass in the same round records nothing and sends nothing.
 * A dirty body, a missing address, or an adapter that does not send is stored as not_configured and
 * still consumes the round, so the same list is not retried every minute.
 */
export async function runReminderJob(deps: ReminderJobDeps, now?: string): Promise<ReminderJobCounts> {
  const due = await deps.due(now);
  const counts: ReminderJobCounts = { sent: 0, recorded: 0, refused: 0 };
  for (const row of due) {
    const claims = Array.isArray(row.claims) ? row.claims : [];
    const address = await deps.addressOf(row.recipient_id);
    const allowed = typeof row.body === "string" && bodyAllowed(row.body);
    const result: ReminderResult = deps.adapter.sends && allowed && address !== null ? "claimed" : "not_configured";
    const inserted = await deps.record(row.recipient_id, claims, result);
    counts.recorded += inserted;
    if (inserted === 0 || inserted !== claims.length || result !== "claimed" || address === null) {
      if (inserted > 0 && result !== "claimed") counts.refused += 1;
      continue;
    }
    await deps.adapter.send(address, row.body);
    counts.sent += 1;
  }
  return counts;
}
