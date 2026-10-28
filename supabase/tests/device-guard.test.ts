/**
 * Migration 0007 (control.device_guard): a revoked device is final, identity columns are
 * immutable, and status only moves forward, for EVERY role including the table owner
 * (council finding 5, B-26). Each case runs as postgres in a rolled-back transaction.
 */
import { describe, expect, it } from "vitest";
import { fx, sqlstate } from "./helpers/db";

// Rep A's approved device (the fixtures approve it).
const approvedA = () => `(select id from public.device where user_id = '${fx.repA.id}' and status = 'approved')`;
// Inside a DO block: a fresh pending device for rep B, its id in v.
const freshPendingB = (fp: string) =>
  `insert into public.device (user_id, device_fingerprint) values ('${fx.repB.id}', repeat('${fp}', 64)) returning id into v;`;

describe("device_guard (migration 0007)", () => {
  it("allows what the app does: last_seen on an approved device, approved -> revoked", async () => {
    expect(await sqlstate("postgres", `update public.device set last_seen_at = now() where id = ${approvedA()}`)).toBeNull();
    expect(await sqlstate("postgres", `update public.device set status = 'revoked', revoked_at = now() where id = ${approvedA()}`)).toBeNull();
  });

  it("allows pending -> approved and pending -> revoked", async () => {
    // One approved device per user (device_one_approved_per_user), so retire B's current one first.
    expect(await sqlstate("postgres", `
      do $$ declare v uuid; begin
        ${freshPendingB("c")}
        update public.device set status = 'revoked', revoked_at = now() where user_id = '${fx.repB.id}' and status = 'approved';
        update public.device set status = 'approved', approved_by = '${fx.manager.id}', approved_at = now() where id = v;
      end $$`)).toBeNull();
    expect(await sqlstate("postgres", `
      do $$ declare v uuid; begin
        ${freshPendingB("d")}
        update public.device set status = 'revoked', revoked_at = now() where id = v;
      end $$`)).toBeNull();
  });

  it("refuses every change to a revoked device, even by the table owner", async () => {
    for (const set of ["status = 'pending', revoked_at = null, revoked_by = null",
                       `status = 'approved', approved_by = '${fx.manager.id}', approved_at = now()`,
                       "last_seen_at = now()"]) {
      expect(await sqlstate("postgres", `
        do $$ declare v uuid; begin
          update public.device set status = 'revoked', revoked_at = now() where id = ${approvedA()} returning id into v;
          update public.device set ${set} where id = v;
        end $$`)).toBe("42501");
    }
  });

  it("refuses identity changes and the backward move approved -> pending", async () => {
    expect(await sqlstate("postgres", `update public.device set user_id = '${fx.repB.id}' where id = ${approvedA()}`)).toBe("42501");
    expect(await sqlstate("postgres", `update public.device set device_fingerprint = repeat('b', 64) where id = ${approvedA()}`)).toBe("42501");
    expect(await sqlstate("postgres", `update public.device set created_at = now() - interval '1 day' where id = ${approvedA()}`)).toBe("42501");
    expect(await sqlstate("postgres", `update public.device set status = 'pending', approved_at = null, approved_by = null where id = ${approvedA()}`)).toBe("42501");
  });
});
