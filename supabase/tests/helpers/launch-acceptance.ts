/**
 * The launch acceptance index (P1-12): every launch security criterion mapped to named evidence.
 *
 * It lives here, not in the test file, because Biome forbids exports from test files. The test
 * (launch-acceptance.test.ts) checks that every reference resolves and that docs/runbooks/launch-security-acceptance.md
 * shows the same mapping. Nothing in this module reads a database.
 *
 * Evidence kinds, and what `ref` is for each:
 *   test     "path::exact test title" - a live test (not skipped, not todo, not it.fails) in that file.
 *   ci       "job" or "job::text" - a job KEY (not its display name) under `jobs:` in .github/workflows/ci.yml;
 *            with `::text`, the job's block must also contain that text (for example the scan script it runs).
 *   manual   a repo path to a runbook that exists.
 *   blocked  the task that must land before the criterion can be proven. Never counted as proof.
 *   defect   "path::exact title" of the `it.fails` check of an OPEN defect against the criterion. Never counted
 *            as proof, and the index test fails once the check stops being an `it.fails` (the defect is fixed),
 *            so the row is cleaned up.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Evidence = { kind: "test" | "ci" | "manual" | "blocked" | "defect"; ref: string };
export type Entry = { criterion: string; evidence: Evidence[] };
/** met: all evidence proves. partial: some proves, some is blocked. blocked: nothing proves yet. defect: an open defect. */
export type Status = "met" | "partial" | "blocked" | "defect";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const CI_FILE = ".github/workflows/ci.yml";
const SEPARATOR = "::";
const TEST_CALLS = ["it", "test", "describe"];
const NOT_RUN = ["skip", "skipIf", "todo", "runIf"];
const QUOTES = ['"', "'", "`"];
const JOB_INDENT = "  ";
const PROVING: Array<Evidence["kind"]> = ["test", "ci", "manual"];

const tests = (file: string, titles: string[]): Evidence[] =>
  titles.map((title) => ({ kind: "test", ref: `supabase/tests/${file}${SEPARATOR}${title}` }));
const blocked = (ref: string): Evidence => ({ kind: "blocked", ref });

// ---------------------------------------------------------------------------------------------------------------
// doc 06 section 10 (security acceptance criteria for launch) and doc 07 section 5 (acceptance tests)
// ---------------------------------------------------------------------------------------------------------------

export const ACCEPTANCE: Entry[] = [
  {
    // 1. RLS matrix tests pass for every table x role, including a rep in territory A failing to read territory B.
    // The matrix names its per-table cases from data (`${name} SELECT ...`), so the static titles below cover the
    // matrix as a whole; the territory and masking cases are the named tests that follow.
    criterion: "06.10.1",
    evidence: [
      ...tests("rls-matrix.test.ts", [
        "every table, view, materialized view and foreign table in our five schemas is covered by the matrix",
        "the coverage query sees a planted view in an exposed schema and a planted table in public",
        "the SELECT comparison catches a same-count leak: repA shown other users' devices instead of its own (L-0116 D2)",
      ]),
      ...tests("schema-hygiene.test.ts", ["every table has RLS enabled AND forced (H-13)"]),
      ...tests("salons.test.ts", ["a rep sees its own territories and areas only", "another territory's rep cannot reveal it"]),
      ...tests("reverify3-attacks.test.ts", [
        "§7.4 list-dump: a rep on the approved phone sees only its own rows; it reads no salon rows (H-14)",
      ]),
      ...tests("verify-slices-1-3.test.ts", [
        "my_salon gives exactly the rows my_salons gives the same rep, masked, and nothing to anyone else",
        "after the office ends rep 1's territory, rep 1 reads and writes nothing of its salon",
        "reveal_phone: own territory only, every rep reveal logged against the session's user; office needs AAL2",
      ]),
      ...tests("crm-attacks.test.ts", ["my_salons caps a page at 50 rows however large the limit, and masks phone numbers"]),
      ...tests("rep-detail-documents.test.ts", [
        "no cost, margin, supplier, credit, fingerprint or GPS key at any depth, and no unmasked phone anywhere",
      ]),
      ...tests("rep-readonly-timelines.test.ts", [
        "an unknown salon id and another territory's salon get the same 42501 for a rep (no lookup first)",
      ]),
    ],
  },
  {
    // 2. No application role can UPDATE/DELETE on any append-only table (tested).
    criterion: "06.10.2",
    evidence: [
      ...tests("append-only-sweep.test.ts", [
        "finds the append-only tables by catalog, and the list is not vacuous",
        "every append-only table has an enabled, unconditional BEFORE UPDATE OR DELETE row trigger",
        "every table that calls itself append-only or immutable has the trigger, and the list is not vacuous",
        "no application role holds an UPDATE, DELETE or TRUNCATE privilege on any append-only or immutable table",
        "%s: UPDATE, DELETE and TRUNCATE on every append-only table are refused (42501)",
        "the table owner is stopped by the trigger when a row exists (planted table with a real row)",
        "the guard reports a planted table whose trigger is missing, disabled, partial or conditional",
      ]),
      ...tests("foundation.test.ts", ["audit_event is append-only even for postgres (UPDATE, DELETE, TRUNCATE)"]),
      ...tests("salons.test.ts", ["notes, stage events and reveals refuse UPDATE, DELETE and TRUNCATE for every role"]),
    ],
  },
  {
    // 3. Owner/manager cannot log in without TOTP; rep cannot operate from an unapproved device (tested).
    // Open defect: app.warehouse_availability() answers the office at AAL1 (see the DEFECT CHECK).
    criterion: "06.10.3",
    evidence: [
      ...tests("device-guard.test.ts", [
        "refuses every change to a revoked device, even by the table owner",
        "refuses identity changes and the backward move approved -> pending",
      ]),
      ...tests("foundation.test.ts", [
        "a rep on an unapproved device cannot act",
        "a suspended rep cannot act, and their devices were revoked",
        "a revoked device id is dead for good: registering it again is refused (0006, L-0035)",
        "owner without MFA (AAL1) cannot create users",
        "vault grant: owner AAL2 yes, manager with grant yes, manager AAL1 no, rep no",
      ]),
      ...tests("verify-slices-1-3.test.ts", ["a rep cannot approve its own pending phone, nor anyone else's"]),
      ...tests("function-gates.test.ts", [
        "the gates exist once each in schema app and still have the parts that make them gates",
        "every function that authenticated or anon can execute calls a gate, or is on the allowlist with a reason",
        "every function that passes only on a device-only gate (self_ok, rep_device_ok) also carries a rep-only marker, or is a named exception",
        "every device-only exception still exists and still passes on a device-only gate alone (a fixed one must leave the list)",
        "anon can execute no function in our schemas",
      ]),
      {
        kind: "defect",
        ref: "supabase/tests/function-gates.test.ts::DEFECT CHECK: an office session without TOTP (AAL1) must not read app.warehouse_availability()",
      },
    ],
  },
  {
    // 4. Vault columns are unreadable via the REST API with any user token (tested); vault reads appear in the
    // access log and the digest. The first half is proven at the database grants; the second needs the vault (P1-05).
    criterion: "06.10.4",
    evidence: [
      ...tests("schema-hygiene.test.ts", [
        "supplier_vault is unreachable for every application role (doc 07 §5.1)",
        "no public column name hints at supplier or cost data (H-01, H-27)",
      ]),
      ...tests("verifier-attacks.test.ts", ["supplier_vault is unreachable for every app role; vault_api has no functions yet"]),
      blocked("P1-05"),
    ],
  },
  {
    // 5. Audit hash chain verifies; mirror receives rows nightly.
    criterion: "06.10.5",
    evidence: [
      ...tests("foundation.test.ts", [
        "verifies after fixtures were created",
        "detects tampering with an existing audit row",
        "no application role can execute the audit or verification functions",
      ]),
      ...tests("schema-hygiene.test.ts", [
        "every table except the audit chain itself has an enabled AFTER ROW INSERT/UPDATE/DELETE audit trigger calling control.audit_row (H-17)",
        "control.audit_event keeps one SELECT policy, owner-only; no app function returns its raw columns",
      ]),
      blocked("audit mirror (no task id yet, MJ assigns)"),
    ],
  },
  {
    // 6. A full offboarding completes from one screen in under 10 minutes (rehearsed).
    criterion: "06.10.6",
    evidence: [blocked("P1-08")],
  },
  {
    // 7. Backup restore drill performed once before go-live, documented. The drill runbook is PR C of P1-12.
    criterion: "06.10.7",
    evidence: [blocked("P1-12 PR C")],
  },
  {
    // 8. Dependency and secret scans clean; service-role key absent from all client bundles (checked in CI).
    // Only the service-role scan exists today; the dependency audit and the secret scan are PR A of P1-12.
    criterion: "06.10.8",
    evidence: [
      { kind: "ci", ref: "typecheck::scripts/service-role-scan.mjs" },
      ...tests("service-role-scan.test.ts", [
        "refuses a key name anywhere in apps or packages, including the lines the old grep skipped",
        "fails closed when a root is missing or nothing is scanned",
        "bundle: library comments pass; key values fail",
      ]),
      blocked("P1-12 PR A"),
    ],
  },
  {
    // 07.5.1 With a rep token, every vault_api function returns permission denied; no vault table appears in the REST
    // schema. (vault_api has no functions yet, so that half holds trivially until P1-05.)
    criterion: "07.5.1",
    evidence: [
      ...tests("schema-hygiene.test.ts", ["supplier_vault is unreachable for every application role (doc 07 §5.1)"]),
      ...tests("verifier-attacks.test.ts", ["supplier_vault is unreachable for every app role; vault_api has no functions yet"]),
      ...tests("reverify3-attacks.test.ts", [
        "§7.2 vault: no persona reaches supplier_vault; the grant is true only for granted office at AAL2, and an owner revoke bites at once",
      ]),
    ],
  },
  {
    // 07.5.2 Manager without grant is refused (tested on the grant check); with grant and AAL2 calls succeed and write
    // access-log rows (needs the vault).
    criterion: "07.5.2",
    evidence: [
      ...tests("verifier-attacks.test.ts", [
        "has_vault_grant is false for reps, AAL1 office, suspended, and a manager right after revoke",
      ]),
      ...tests("foundation.test.ts", ["vault grant: owner AAL2 yes, manager with grant yes, manager AAL1 no, rep no"]),
      blocked("P1-05"),
    ],
  },
  { criterion: "07.5.3", evidence: [blocked("P1-05")] },
  { criterion: "07.5.4", evidence: [blocked("P1-05")] },
  { criterion: "07.5.5", evidence: [blocked("P1-05")] },
  {
    // 07.5.6 Revoking the manager's grant takes effect on the next request (the grant check is tested; its effect on
    // vault calls needs the vault).
    criterion: "07.5.6",
    evidence: [
      ...tests("foundation.test.ts", ["revoking the manager's vault grant takes effect on the next request (doc 07 §5.6)"]),
      blocked("P1-05"),
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Additional controls checked. Not rows of doc 06 section 10 or doc 07 section 5, so they get their own ids rather
// than invented criterion numbers. They come from the hard rules in docs/ACTIVITY.md (H-12, H-09).
// ---------------------------------------------------------------------------------------------------------------

export const ADDITIONAL: Entry[] = [
  {
    // H-12 Maker = checker is a database constraint on every approval, not a UI rule.
    criterion: "ADD.1",
    evidence: tests("foundation.test.ts", [
      "the maker can never approve their own request, even the owner",
      "the database constraint holds even for a direct write by postgres",
      "a rep cannot request owner-level kinds, and cannot decide anything",
    ]),
  },
  {
    // H-09 Server time is authoritative; client timestamps are evidence only.
    criterion: "ADD.2",
    evidence: [
      ...tests("crm-attacks.test.ts", [
        "a backdated or future client timestamp never moves the server timestamps (H-09)",
        "a delivery needs a receiver name and sane GPS; a backdated client time does not move the invoice time (H-09)",
        "a stock count and a demand signal accept no backdated server time (H-09)",
      ]),
      ...tests("payments.test.ts", ["the phone's time is kept as evidence only: recorded_at is the database's time"]),
      ...tests("verifier-attacks.test.ts", ["created_at is server time; a caller cannot backdate a request (§7.6)"]),
      ...tests("verify-slices-1-3.test.ts", [
        "a visit needs GPS, is one row per client id, and a backdated arrival does not move the server time",
      ]),
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------------------------------------------

/** Read a repo file with line endings normalised, or null when it does not exist. */
const readIfExists = (root: string, rel: string): string | null =>
  existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8").replaceAll("\r\n", "\n") : null;

type Declaration = { mods: string[] };

/** The call a quoted title sits in, read from the text before it on its line: `it(`, `it.skip(`, `it.each(X)(`. */
const declarationOf = (head: string): Declaration | null => {
  const code = head.trim();
  if (!code.endsWith("(")) return null;
  const [root, ...mods] = code.slice(0, -1).split(".");
  return TEST_CALLS.includes(root.split("(")[0]) ? { mods: mods.map((m) => m.split("(")[0]) } : null;
};

/** Every place the title appears as a quoted string, as the declaration around it (comments and calls like expect(...) give none). */
const declarationsOf = (text: string, title: string): Declaration[] =>
  text
    .split("\n")
    .flatMap((line) =>
      QUOTES.map((q) => line.indexOf(`${q}${title}${q}`))
        .filter((at) => at >= 0)
        .map((at) => declarationOf(line.slice(0, at))),
    )
    .filter((d): d is Declaration => d !== null);

const splitRef = (ref: string): [string, string] | null => {
  const at = ref.indexOf(SEPARATOR);
  return at < 0 ? null : [ref.slice(0, at), ref.slice(at + SEPARATOR.length)];
};

const checkTest =
  (want: "live" | "fails") =>
  (ref: string, root: string): string | null => {
    const parts = splitRef(ref);
    if (!parts) return "a test reference must be path::title";
    const text = readIfExists(root, parts[0]);
    if (text === null) return `file ${parts[0]} does not exist`;
    const found = declarationsOf(text, parts[1]);
    if (found.length === 0) return `no test or describe with that exact title in ${parts[0]}`;
    const fits = found.some((d) => !d.mods.some((m) => NOT_RUN.includes(m)) && d.mods.includes("fails") === (want === "fails"));
    if (fits) return null;
    return want === "fails"
      ? "the title exists but is not an it.fails check: the defect may be fixed, so remove this row"
      : "the title exists but is skipped, todo or expected to fail (it.fails), so it proves nothing";
  };

const JOB_KEY_SHAPE = (line: string) =>
  line.startsWith(JOB_INDENT) &&
  !line.startsWith(`${JOB_INDENT} `) &&
  !line.trimStart().startsWith("#") &&
  line.trimEnd().endsWith(":");

/** The lines of one job under `jobs:`, or null when there is no such job. */
const jobBlock = (yml: string, job: string): string | null => {
  const lines = yml.split("\n");
  const jobs = lines.indexOf("jobs:");
  const at = lines.findIndex((l, i) => i > jobs && jobs >= 0 && l.trimEnd() === `${JOB_INDENT}${job}:`);
  if (at < 0) return null;
  const next = lines.findIndex((l, i) => i > at && JOB_KEY_SHAPE(l));
  return lines.slice(at + 1, next < 0 ? undefined : next).join("\n");
};

const checkCi = (ref: string, root: string): string | null => {
  const yml = readIfExists(root, CI_FILE);
  if (yml === null) return `${CI_FILE} does not exist`;
  const [job, text] = splitRef(ref) ?? [ref, ""];
  const block = jobBlock(yml, job);
  if (block === null) return `no job with the key "${job}" under jobs: in ${CI_FILE}`;
  return block.includes(text) ? null : `job "${job}" does not contain "${text}"`;
};

const CHECKS: Record<Evidence["kind"], (ref: string, root: string) => string | null> = {
  test: checkTest("live"),
  defect: checkTest("fails"),
  ci: checkCi,
  manual: (ref, root) => (readIfExists(root, ref) === null ? `file ${ref} does not exist` : null),
  blocked: (ref) => (ref.trim() === "" ? "a blocked entry must name the task it waits for" : null),
};

/** One message per broken reference; an entry with no evidence is itself broken. */
export const checkEvidence = (entry: Entry, root: string): string[] => {
  if (entry.evidence.length === 0) return [`${entry.criterion}: no evidence`];
  return entry.evidence.flatMap((ev) => {
    const check = CHECKS[ev.kind] as ((ref: string, root: string) => string | null) | undefined;
    const why = check ? check(ev.ref, root) : `unknown evidence kind "${ev.kind}"`;
    return why ? [`${entry.criterion} ${ev.kind} ${ev.ref}: ${why}`] : [];
  });
};

/** What the evidence adds up to. Blocked and defect entries never count as proof. */
export const statusOf = (entry: Entry): Status => {
  const kinds = entry.evidence.map((v) => v.kind);
  if (kinds.includes("defect")) return "defect";
  if (!kinds.some((k) => PROVING.includes(k))) return "blocked";
  return kinds.includes("blocked") ? "partial" : "met";
};
