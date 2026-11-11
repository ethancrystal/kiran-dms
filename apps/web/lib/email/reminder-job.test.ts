import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyAllowed,
  type DueReminder,
  fakeAdapter,
  type MailAdapter,
  type ReminderClaim,
  type ReminderResult,
  runReminderJob,
  unconfiguredAdapter,
} from "./reminder-job.ts";

const claim = (round = 0): ReminderClaim => ({ kind: "salon", item_id: "00000000-0000-4000-8000-000000000000", round_no: round });

const clean =
  "Salon proposal. Reference 00000000-0000-4000-8000-000000000000. Waiting under an hour. Open /office/salons/approvals";

function harness(opts: {
  adapter: MailAdapter;
  address?: string | null;
  body?: string;
  inserted?: number | ((result: ReminderResult) => number);
}) {
  const recorded: Array<{ result: ReminderResult; claims: ReminderClaim[] }> = [];
  const dueRow: DueReminder = {
    recipient_id: "11111111-1111-4111-8111-111111111111",
    body: opts.body ?? clean,
    claims: [claim()],
  };
  const deps = {
    due: async () => [dueRow],
    addressOf: async () => (opts.address === undefined ? "owner@example.com" : opts.address),
    record: async (_id: string, claims: ReminderClaim[], result: ReminderResult) => {
      recorded.push({ result, claims });
      if (typeof opts.inserted === "function") return opts.inserted(result);
      if (opts.inserted !== undefined) return opts.inserted;
      return claims.length;
    },
    adapter: opts.adapter,
  };
  return { deps, recorded };
}

describe("reminder body", () => {
  it("allows a reference uuid and refuses a price or a phone", () => {
    assert.equal(bodyAllowed(clean), true);
    assert.equal(bodyAllowed("00000000000000000000000000000000"), true);
    assert.equal(bodyAllowed("Waiting on Rs 500"), false);
    assert.equal(bodyAllowed("paisa 100"), false);
    assert.equal(bodyAllowed("call +92 3001234567"), false);
    assert.equal(bodyAllowed("03001234567"), false);
    assert.equal(bodyAllowed("030012345678"), true);
  });
});

describe("runReminderJob", () => {
  it("sends only after the round is claimed in full", async () => {
    const sent: Array<{ to: string; body: string }> = [];
    const { deps, recorded } = harness({ adapter: fakeAdapter(sent) });
    const counts = await runReminderJob(deps);
    assert.deepEqual(counts, { sent: 1, recorded: 1, refused: 0 });
    assert.equal(recorded[0]?.result, "claimed");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "owner@example.com");
    assert.equal(sent[0]?.body, clean);
  });

  it("does not send when the round was already recorded", async () => {
    const sent: Array<{ to: string; body: string }> = [];
    const { deps } = harness({ adapter: fakeAdapter(sent), inserted: 0 });
    const counts = await runReminderJob(deps);
    assert.deepEqual(counts, { sent: 0, recorded: 0, refused: 0 });
    assert.equal(sent.length, 0);
  });

  it("records not_configured for a dirty body and does not send", async () => {
    const sent: Array<{ to: string; body: string }> = [];
    const { deps, recorded } = harness({ adapter: fakeAdapter(sent), body: "Balance Rs 10" });
    const counts = await runReminderJob(deps);
    assert.deepEqual(counts, { sent: 0, recorded: 1, refused: 1 });
    assert.equal(recorded[0]?.result, "not_configured");
    assert.equal(sent.length, 0);
  });

  it("records not_configured when there is no address", async () => {
    const sent: Array<{ to: string; body: string }> = [];
    const { deps, recorded } = harness({ adapter: fakeAdapter(sent), address: null });
    const counts = await runReminderJob(deps);
    assert.deepEqual(counts, { sent: 0, recorded: 1, refused: 1 });
    assert.equal(recorded[0]?.result, "not_configured");
    assert.equal(sent.length, 0);
  });

  it("uses the unconfigured adapter without calling send", async () => {
    const adapter = unconfiguredAdapter();
    let called = false;
    const wrapped: MailAdapter = {
      sends: adapter.sends,
      send: async () => {
        called = true;
        await adapter.send("x", "y");
      },
    };
    const { deps, recorded } = harness({ adapter: wrapped });
    const counts = await runReminderJob(deps);
    assert.deepEqual(counts, { sent: 0, recorded: 1, refused: 1 });
    assert.equal(recorded[0]?.result, "not_configured");
    assert.equal(called, false);
  });
});
