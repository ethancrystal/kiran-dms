/**
 * P1-12 Task 6: the backup manifest comparison (doc 06 section 10.7).
 *
 * `compareManifests` is pure, so it is tested here with hand-built manifests. `buildManifest`
 * reads a live database and is exercised by the Task 8 rehearsal, not by this file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildManifest, compareManifests } from "./manifest.mjs";

/** A manifest with every field the comparison reads; each case changes one thing. */
const base = () => ({
  createdAt: "2026-11-18T00:00:00.000Z",
  migrations: ["20261024223304", "20261028050000"],
  tables: { "public.salon": 12, "control.audit_event": 40 },
  rlsForced: { "public.salon": true, "control.audit_event": true },
  authUsers: 3,
  auditHead: { seq: 40, hash: "a".repeat(64) },
});

test("equal manifests compare clean", () => {
  assert.deepEqual(compareManifests(base(), base()), []);
});

test("a differing createdAt alone is ignored (a dump and a restore are taken at different times)", () => {
  const restored = base();
  restored.createdAt = "2026-11-19T00:00:00.000Z";
  assert.deepEqual(compareManifests(base(), restored), []);
});

test("a table whose row count differs names the table and both counts", () => {
  const restored = base();
  restored.tables["public.salon"] = 11;
  assert.deepEqual(compareManifests(base(), restored), [
    "public.salon: 12 rows before, 11 after",
  ]);
});

test("a table that vanished, or appeared, is named", () => {
  const gone = base();
  delete gone.tables["public.salon"];
  assert.deepEqual(compareManifests(base(), gone), ["public.salon: the table is gone after the restore"]);

  const extra = base();
  extra.tables["public.salon_note"] = 1;
  assert.deepEqual(compareManifests(base(), extra), [
    "public.salon_note: the table is new after the restore",
  ]);
});

test("a migration missing after the restore is named, and so is a new one", () => {
  const restored = base();
  restored.migrations = ["20261024223304"];
  assert.deepEqual(compareManifests(base(), restored), [
    "migration 20261028050000 is missing after the restore",
  ]);

  const added = base();
  added.migrations = [...base().migrations, "20261101010000"];
  assert.deepEqual(compareManifests(base(), added), [
    "migration 20261101010000 is new after the restore",
  ]);
});

test("a table whose RLS stopped being forced is named", () => {
  const restored = base();
  restored.rlsForced["public.salon"] = false;
  assert.deepEqual(compareManifests(base(), restored), [
    "public.salon: RLS is no longer forced after the restore",
  ]);
});

test("a different auth user count is named (people must be able to sign in after a restore)", () => {
  const restored = base();
  restored.authUsers = 2;
  assert.deepEqual(compareManifests(base(), restored), ["auth users: 3 before, 2 after"]);
});

test("a different audit head is named, and an empty chain reads as none", () => {
  const restored = base();
  restored.auditHead = { seq: 39, hash: "b".repeat(64) };
  assert.deepEqual(compareManifests(base(), restored), [
    `audit head: 40/${"a".repeat(64)} before, 39/${"b".repeat(64)} after`,
  ]);

  const emptied = base();
  emptied.auditHead = null;
  assert.deepEqual(compareManifests(base(), emptied), [
    `audit head: 40/${"a".repeat(64)} before, none after`,
  ]);
});

test("the guard itself is not vacuous: a planted difference is reported, and a function exists", () => {
  assert.equal(typeof buildManifest, "function");
  assert.equal(typeof compareManifests, "function");
  const planted = base();
  planted.tables["public.salon"] = 0;
  assert.equal(compareManifests(base(), planted).length, 1);
});
