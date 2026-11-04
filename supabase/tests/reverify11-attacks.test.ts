/**
 * Eleventh re-verification (ACTIVITY §7) of P0-06 (RLS harness and schema guards) and the protocol
 * log check P0-09 (scripts/activity-log-check.mjs). Written by the re-verifier-11 workflow, not the
 * builder; first recorded in an unmerged entry (local commit a2b1105, there numbered L-0127) and
 * carried onto main by ACTIVITY L-0226. P0-02 is probed in
 * packages/import/tests/reverify11-import.test.ts.
 *
 * Database part: every case runs as postgres (switching to a fixture persona where stated) inside
 * one transaction that is always rolled back. The plants are owner-level statements (GRANT, CREATE
 * POLICY) on tables the migration role owns, so they behave the same on the local embedded Postgres
 * (superuser) and on the CI Supabase stack (not superuser). Whether the HARNESS catches a plant is
 * decided from the WORKTREE files at run time: every evaluable SELECT query in schema-hygiene.test.ts
 * and rls-matrix.test.ts is run before and with the plant, and every write probe of the matrix loop
 * is run as repA with the plant. A builder fix in either file flips these checks with no edit here
 * other than the marker change below.
 *
 * Log-check part: each case is a throwaway clone (os tmpdir, deleted afterwards) whose base commit
 * carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * Nothing leaves the machine. DATABASE_URL / KIRAN_TEST_DATABASE_URL are stripped from the child
 * env. Connection strings are assembled at run time and hold only variable references.
 *
 * Test kinds (MJ decision, ACTIVITY L-0225):
 * - "CONTROL" checks the harness itself and passes either way.
 * - "REPRODUCTION" is an ordinary test that proves the attack scenario really ran (the plant took
 *   effect, the checker executed). If it fails, the setup is broken; it never counts as a
 *   reproduced defect.
 * - "DEFECT CHECK" / "FALSE POSITIVE CHECK" states the secure or honest expectation with one
 *   decisive assertion. While the defect exists it is marked `it.fails` (an expected failure, so
 *   CI stays green). When a builder fixes the defect, the check passes, `it.fails` reports that as
 *   a failure, and the builder must change `it.fails` to `it` in the same pull request as the fix.
 * Do not loosen, skip or delete any of these (H-23).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fx, run, sqlstate } from "./helpers/db";
import { overlayWorktree, writeLogEntries } from "./log-check-harness";

const ROOT = resolve(import.meta.dirname, "../..");

// Characters of a harness query kept in the log label.
const QUERY_LABEL_CHARS = 60;
// The harness files hold at least this many evaluable SELECT queries (schema guards + matrix).
const MIN_HARNESS_QUERIES = 5;
// In a board row split on "|", the Status cell is the third piece from the end
// ("| ... | Status | Claimed by |" splits to [..., " Status ", " Claimed by ", ""]).
const STATUS_CELL_FROM_END = 3;
// Each log-check case clones the repository; the whole describe block may take minutes.
const LOG_CHECK_TIMEOUT_MS = 900_000;
// Two backslashes before a pipe: GFM keeps the pipe escaped, the checker splits on it.
const BACKSLASHES_BEFORE_PIPE = 2;

// ---------------------------------------------------------------------------------------------
// Database part (P0-06 harness)
// ---------------------------------------------------------------------------------------------
// A block comment: matches "/* any text */", rejects "// a line comment".
// Tester: https://regex101.com/?regex=%5C%2F%5C*%5B%5Cs%5CS%5D*%3F%5C*%5C%2F&flags=g&flavor=javascript&testString=%2F*%20any%20text%20*%2F%0A%2F%2F%20a%20line%20comment
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
// A whole-line // comment: matches "  // a line comment", rejects "x = 1; // trailing".
// Tester: https://regex101.com/?regex=%5E%5Cs*%5C%2F%5C%2F.*%24&flags=gm&flavor=javascript&testString=%20%20%2F%2F%20a%20line%20comment%0Ax%20%3D%201%3B%20%2F%2F%20trailing
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const stripComments = (s: string) => s.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
const HYG = stripComments(readFileSync(join(import.meta.dirname, "schema-hygiene.test.ts"), "utf8"));
const MATRIX = stripComments(readFileSync(join(import.meta.dirname, "rls-matrix.test.ts"), "utf8"));
// A string constant declaration in a harness file. For name SCHEMAS it matches
// 'const SCHEMAS = "public";' (capturing "public") and rejects 'const SCHEMAS = ["public"];'.
// Tester: https://regex101.com/?regex=const%20SCHEMAS%20%3D%20(%3F%3A%22(%5B%5E%22%5D*)%22%7C%60(%5B%5E%60%5D*)%60)%3B&flags=&flavor=javascript&testString=const%20SCHEMAS%20%3D%20%22public%22%3B%0Aconst%20SCHEMAS%20%3D%20%5B%22public%22%5D%3B
const constDeclaration = (name: string) => new RegExp(`const ${name} = (?:"([^"]*)"|\`([^\`]*)\`);`);
const constOf = (src: string, name: string) =>
  (src.match(constDeclaration(name)) ?? []).slice(1).find((x) => x !== undefined) ?? "";
const SUBST: Record<string, string> = {
  "${SCHEMAS}": constOf(HYG, "SCHEMAS"),
  "${notExtension}": constOf(HYG, "notExtension"),
};
// Template literals: matches "`select 1`" (capturing "select 1"), rejects "'select 1'".
// Tester: https://regex101.com/?regex=%60(%5B%5E%60%5D*)%60&flags=g&flavor=javascript&testString=%60select%201%60%0A'select%201'
const TEMPLATE_LITERAL = /`([^`]*)`/g;
// A SELECT query: matches "  select * from t", rejects "update t set x = 1".
// Tester: https://regex101.com/?regex=%5E%5Cs*select%5Cb&flags=i&flavor=javascript&testString=%20%20select%20*%20from%20t%0Aupdate%20t%20set%20x%20%3D%201
const IS_SELECT = /^\s*select\b/i;
// Every SELECT template literal in the two harness files whose interpolations this file can fill.
const HARNESS_QUERIES = [HYG, MATRIX]
  .flatMap((src) => [...src.matchAll(TEMPLATE_LITERAL)].map((m) => m[1]))
  .map((q) => Object.entries(SUBST).reduce((acc, [k, v]) => acc.replaceAll(k, v), q))
  .filter((q) => IS_SELECT.test(q) && !q.includes("${"));
// A matrix write probe pair: matches '["UPDATE", `update t set c = c`]' (capturing "UPDATE" and the
// SQL), rejects '["update", `update t`]' (operation names are upper case).
// Tester: https://regex101.com/?regex=%5C%5B%5Cs*%22(%5BA-Z%20%5D%2B)%22%2C%5Cs*%60(%5B%5E%60%5D*)%60%5Cs*%5C%5D&flags=g&flavor=javascript&testString=%5B%22UPDATE%22%2C%20%60update%20t%20set%20c%20%3D%20c%60%5D%0A%5B%22update%22%2C%20%60update%20t%60%5D
const WRITE_PROBE = /\[\s*"([A-Z ]+)",\s*`([^`]*)`\s*\]/g;
// The matrix loop's write probes, filled in for one table.
const ROW_TABLE_TOKEN = `${"$"}{row.table}`;
const ROW_WRITE_COL_TOKEN = `${"$"}{row.writeCol}`;
const WRITE_PROBES = (table: string, writeCol: string) =>
  [...MATRIX.matchAll(WRITE_PROBE)]
    .map(([, op, sql]) => [op, sql.replaceAll(ROW_TABLE_TOKEN, table).replaceAll(ROW_WRITE_COL_TOKEN, writeCol)] as const)
    .filter(([, sql]) => !sql.includes("${"));
const AS_REP_A =
  () => `select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
  set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true); set local role authenticated`;
const lastRows = (res: unknown) => {
  const arr = Array.isArray(res) ? res : [res];
  return (arr[arr.length - 1] as { rows: unknown[] }).rows.map((r) => JSON.stringify(r));
};
const rowsOf = (res: unknown) => (res as Array<{ rows: Array<Record<string, unknown>> }>).map((r) => r.rows);
// Runs of whitespace: matches "a \n  b" between a and b, rejects "ab".
// Tester: https://regex101.com/?regex=%5Cs%2B&flags=g&flavor=javascript&testString=a%20%0A%20%20b%0Aab
const WHITESPACE_RUN = /\s+/g;
type HarnessResult = { caughtBy: string[]; queries: number; probes: string[] };

// Does one harness query show a new row naming the table once the plant is in place? Queries that
// cannot run here (they need the vitest context) are skipped, as before.
async function queryCatches(plant: string, relname: string, q: string): Promise<string | undefined> {
  try {
    const before = lastRows(await run("postgres", q));
    const after = lastRows(await run("postgres", `${plant}; ${q}`));
    return after.some((r) => !before.includes(r) && r.includes(relname))
      ? `query: ${q.trim().slice(0, QUERY_LABEL_CHARS).replace(WHITESPACE_RUN, " ")}`
      : undefined;
  } catch {
    return undefined;
  }
}
// Does one matrix write probe, refused (42501) without the plant, get through with it?
async function probeCatches(plant: string, op: string, sql: string): Promise<string | undefined> {
  const base = await sqlstate("postgres", `${AS_REP_A()}; ${sql}`);
  const planted = await sqlstate("postgres", `${plant}; ${AS_REP_A()}; ${sql}`);
  return base === "42501" && planted !== "42501" ? `matrix ${op} probe` : undefined;
}
// Does the harness (schema-hygiene guards, matrix queries, matrix write probes as repA) notice the
// plant on `table`? Checks run one after another (reduce over a promise chain), as before.
async function harnessCatches(plant: string, table: string, writeCol: string): Promise<HarnessResult> {
  const relname = table.split(".")[1];
  const probes = WRITE_PROBES(table, writeCol);
  const checks: Array<() => Promise<string | undefined>> = [
    ...HARNESS_QUERIES.map((q) => () => queryCatches(plant, relname, q)),
    ...probes.map(
      ([op, sql]) =>
        () =>
          probeCatches(plant, op, sql),
    ),
  ];
  const caughtBy = await checks.reduce<Promise<string[]>>(async (accP, next) => {
    const acc = await accP;
    const hit = await next();
    return hit ? [...acc, hit] : acc;
  }, Promise.resolve([]));
  return { caughtBy, queries: HARNESS_QUERIES.length, probes: probes.map(([op]) => op) };
}

// Results of the REPRODUCTION tests, read by the DEFECT CHECKs that follow them (tests in a file
// run in order).
const db: { updatePlant?: HarnessResult; truncatePlant?: HarnessResult } = {};

describe("P0-06 harness (re-verifier-11)", () => {
  it("CONTROL: the extraction finds the guards and the three write probes, and catches a disabled audit trigger", async () => {
    expect(HARNESS_QUERIES.length).toBeGreaterThanOrEqual(MIN_HARNESS_QUERIES);
    expect(WRITE_PROBES("public.app_config", "note").map(([op]) => op)).toEqual(
      expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
    );
    const r = await harnessCatches("alter table public.app_config disable trigger audit", "public.app_config", "note");
    expect(r.caughtBy.length).toBeGreaterThan(0);
  });

  // P0-06 D1 (workflow id V11-D2; H-08, H-13; matrix header: every application role is refused
  // direct UPDATE). The UPDATE probe is 'update T set writeCol = writeCol', which raises 42501
  // whenever the role lacks UPDATE on writeCol alone. A column-level UPDATE grant on another column
  // plus a permissive UPDATE policy lets repA write the table directly while every cell and guard
  // stays green. Latent: no such grant or UPDATE policy exists today. The bypass needs both.
  const updatePlant = `grant update (rep_visible) on public.app_config to authenticated;
    create policy zz_rv11_upd on public.app_config for update to authenticated using (true) with check (true)`;
  it("REPRODUCTION (P0-06 D1): with the column grant and the policy, repA's direct UPDATE changes rows", async () => {
    const [, , before, , , , , after] = rowsOf(
      await run(
        "postgres",
        `${updatePlant};
      select count(*) filter (where rep_visible)::int vis, (select count(*)::int from control.audit_event) audit from public.app_config;
      ${AS_REP_A()};
      update public.app_config set rep_visible = true;
      reset role;
      select count(*) filter (where rep_visible)::int vis, (select count(*)::int from control.audit_event) audit from public.app_config`,
      ),
    );
    db.updatePlant = await harnessCatches(updatePlant, "public.app_config", "note");
    console.log(
      "rv11 P0-06 D1 demo (before, after as repA):",
      JSON.stringify(before),
      JSON.stringify(after),
      "| harness:",
      JSON.stringify(db.updatePlant),
    );
    expect((after[0] as { vis: number }).vis).toBeGreaterThan((before[0] as { vis: number }).vis);
  });
  it.fails("DEFECT CHECK (P0-06 D1, H-13): the harness notices a column-level UPDATE grant plus an UPDATE policy", () => {
    expect(db.updatePlant?.caughtBy.length ?? 0, "a harness check must notice the plant").toBeGreaterThan(0);
  });

  // P0-06 D2 (workflow id V11-D3; H-13 deny by default; doc 06: the matrix asserts exactly what is
  // allowed). The matrix write cells cover INSERT, UPDATE and DELETE only, and no guard checks
  // TRUNCATE privilege, which ignores RLS and fires no row-level audit trigger. Latent: no TRUNCATE
  // grant exists today. Whether AUDIT_GAPS should also require a TRUNCATE trigger is B-17 (MJ), not
  // part of this check.
  const truncatePlant = "grant truncate on public.app_config to authenticated";
  it("REPRODUCTION (P0-06 D2): with the TRUNCATE grant, repA empties the table", async () => {
    const [, before, , , , , after] = rowsOf(
      await run(
        "postgres",
        `${truncatePlant};
      select count(*)::int n, (select count(*)::int from control.audit_event) audit from public.app_config;
      ${AS_REP_A()};
      truncate public.app_config;
      reset role;
      select count(*)::int n, (select count(*)::int from control.audit_event) audit from public.app_config`,
      ),
    );
    db.truncatePlant = await harnessCatches(truncatePlant, "public.app_config", "note");
    console.log(
      "rv11 P0-06 D2 demo (before, after repA truncate):",
      JSON.stringify(before),
      JSON.stringify(after),
      "| harness:",
      JSON.stringify(db.truncatePlant),
    );
    expect((before[0] as { n: number }).n).toBeGreaterThan(0);
    expect((after[0] as { n: number }).n).toBe(0);
  });
  it.fails("DEFECT CHECK (P0-06 D2, H-13): the matrix or the guards notice a TRUNCATE grant to an application role", () => {
    expect(db.truncatePlant?.caughtBy.length ?? 0, "a harness check must notice the plant").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Log-check part (P0-09)
// ---------------------------------------------------------------------------------------------
const OTHER = "Tester · Model X · rv11-case-agent · branch t";
const entry = (type: string, task: string, sig = OTHER) => [
  `# 2026-10-29 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}`,
  "**What / why:** rv11 case.",
  "**Evidence:** rv11 case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  ...["", "Security checklist (tick honestly):", '[x] No control weakened, skipped or "temporarily" disabled (H-16)'],
  "",
];
const P = entry("TASK", "P0-09");
// The checker's verdict line: matches "activity-log-check OK (1 new log entry...)" and
// "activity-log-check FAILED:", rejects "Error: Cannot find module".
// Tester: https://regex101.com/?regex=%5Eactivity-log-check%20(OK%7CFAILED)&flags=&flavor=javascript&testString=activity-log-check%20OK%20(1%20new%20log%20entry)%0AError%3A%20Cannot%20find%20module
const VERDICT_LINE = /^activity-log-check (OK|FAILED)/;

type G = (...a: string[]) => string;
type Case = { lines?: string[]; mutate?: (text: string) => string; files?: Record<string, string | Buffer> };
type CheckResult = { status: number | null; out: string };
function check(c: Case): CheckResult {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv11-log-"));
  try {
    const g: G = (...a) => {
      const r = spawnSync(
        "git",
        ["-c", "core.autocrlf=false", "-c", "user.name=rv11", "-c", "user.email=rv11@example.test", ...a],
        { cwd: dir, encoding: "utf8" },
      );
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    overlayWorktree(ROOT, dir);
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv11 base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    writeLogEntries(dir, c.lines ?? P);
    const logPath = join(dir, "docs", "ACTIVITY.md");
    let text = readFileSync(logPath, "utf8");
    if (c.mutate) text = c.mutate(text);
    writeFileSync(logPath, text);
    Object.entries(c.files ?? {}).forEach(([rel, content]) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    });
    g("add", "-A");
    g("commit", "-q", "-m", "rv11 case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// The checker really ran: it exited 0 or 1 with its own verdict line.
const ran = (r: CheckResult) => (r.status === 0 || r.status === 1) && VERDICT_LINE.test(r.out);
const firstLine = (r: CheckResult) => JSON.stringify(r.out.split("\n")[0]);
const row = (task: string, fn: (line: string) => string) => (t: string) =>
  t
    .split("\n")
    .map((l) => (l.startsWith(`| ${task} |`) ? fn(l) : l))
    .join("\n");
const withStatus = (status: string) => (l: string) => {
  const cells = l.split("|");
  cells[cells.length - STATUS_CELL_FROM_END] = ` ${status} `;
  return cells.join("|");
};
const setStatus = (task: string, status: string) => row(task, withStatus(status));
// Connection strings holding only variable references, assembled at run time.
const uri = (user: string, ref: string, host: string) => ["postgresql://", user, ":", ref, "@", host].join("");

const log: {
  staleVerdict?: { p101: CheckResult; p008: CheckResult };
  dupHeader?: CheckResult;
  escapedPipe?: CheckResult;
  uriReference?: { compose: CheckResult; shell: CheckResult };
} = {};

describe("activity-log-check P0-09 (re-verifier-11)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("CONTROL: an uncited move and a move citing a verdict older than the latest DONE are refused; a query-parameter reference passes", () => {
    expect(check({ mutate: setStatus("P0-09", "VERIFIED") }).status).toBe(1);
    expect(check({ mutate: setStatus("P0-06", "VERIFIED (L-0116)") }).status).toBe(1);
    const q = check({
      files: {
        "docker-compose.yml": `services:\n  app:\n    environment:\n      DATABASE_URL: postgresql://postgres@db:5432/postgres?password=${"$"}{POSTGRES_PASSWORD}\n`,
      },
    });
    expect(q.status, q.out).toBe(0);
  });

  // P0-09 D1 (workflow id A7; §7: rework is reopened via CORRECTION to IN PROGRESS; MJ L-0110 "then a
  // fresh verification"; §4 the log wins). Rule 4b runs only when a Status cell's text changes (the
  // 'continue' in the board loop), so a new DONE for a task whose row already reads VERIFIED (L-nnnn)
  // leaves the row citing a verdict older than the task's latest DONE. Appendix C rule 4 as written
  // scopes the ordering to a changed cell, so the gap is in spec and code.
  it("REPRODUCTION (P0-09 D1): the checker runs on a new DONE entry for P1-01 and for P0-08", () => {
    log.staleVerdict = { p101: check({ lines: entry("TASK", "P1-01") }), p008: check({ lines: entry("TASK", "P0-08") }) };
    console.log(
      "rv11 P0-09 D1:",
      log.staleVerdict.p101.status,
      firstLine(log.staleVerdict.p101),
      log.staleVerdict.p008.status,
      firstLine(log.staleVerdict.p008),
    );
    expect(ran(log.staleVerdict.p101) && ran(log.staleVerdict.p008)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-09 D1, rule 4b): a new DONE entry under an untouched VERIFIED row is refused", () => {
    expect({ p101: log.staleVerdict?.p101.status, p008: log.staleVerdict?.p008.status }).toEqual({ p101: 1, p008: 1 });
  });

  // P0-09 D2 (workflow id A1; rule 4: the board is read the way GitHub renders tables; the Status
  // column is found by its header). statusIdx takes the FIRST header cell reading 'status';
  // renaming Refs to Status makes the checker read the Refs cell while the second Status column
  // renders bare VERIFIED.
  const hdr = "| ID | Work item | Refs | Status | Claimed by |";
  it("REPRODUCTION (P0-09 D2): the Phase 0 header exists and the checker runs with it duplicated", () => {
    expect(readFileSync(join(ROOT, "docs", "ACTIVITY.md"), "utf8").includes(hdr)).toBe(true);
    log.dupHeader = check({
      mutate: (t) => setStatus("P0-09", "VERIFIED")(t.replace(hdr, "| ID | Work item | Status | Status | Claimed by |")),
    });
    console.log("rv11 P0-09 D2:", log.dupHeader.status, firstLine(log.dupHeader));
    expect(ran(log.dupHeader)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-09 D2, rule 4b): a duplicate Status header cannot hide a bare VERIFIED", () => {
    expect(log.dupHeader?.status).toBe(1);
  });

  // P0-09 D3 (workflow id A2; rule 4: cells split on unescaped pipes, as GFM does). rowOf() lets a
  // backslash escape any next character, so in two backslashes then a pipe the pipe splits the cell;
  // GFM keeps it as an escaped pipe. The checker's cells shift right and it reads the Refs cell as
  // Status.
  const escapedLine = `| P0-09 | **Enforce this protocol** ${"\\".repeat(BACKSLASHES_BEFORE_PIPE)}| CI check | this file | VERIFIED | C-001 |`;
  it("REPRODUCTION (P0-09 D3): the checker runs with the P0-09 row rewritten around two backslashes and a pipe", () => {
    log.escapedPipe = check({ mutate: row("P0-09", () => escapedLine) });
    console.log("rv11 P0-09 D3 row:", JSON.stringify(escapedLine), "| exit:", log.escapedPipe.status, firstLine(log.escapedPipe));
    expect(ran(log.escapedPipe)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-09 D3, rule 4b): two backslashes before a pipe cannot hide a bare VERIFIED", () => {
    expect(log.escapedPipe?.status).toBe(1);
  });

  // P0-09 FP1 (rule 5: connection strings with a password, "placeholders and ${…} or $VAR references
  // excepted"). The URI user:password@host pattern excepts placeholders but not references, while
  // the query-parameter and libpq forms do; the history pass makes the refusal permanent for any
  // commit in the range.
  it("REPRODUCTION (P0-09 FP1): the checker runs on a compose file and a shell script with a URI password reference", () => {
    log.uriReference = {
      compose: check({
        files: {
          "docker-compose.yml": `services:\n  app:\n    environment:\n      DATABASE_URL: ${uri("postgres", `${"$"}{POSTGRES_PASSWORD}`, "db:5432/postgres")}\n`,
        },
      }),
      shell: check({ files: { "scripts/x.sh": `#!/bin/sh\npsql "${uri("app", `${"$"}PGPASSWORD`, "db:5432/app")}"\n` } }),
    };
    console.log(
      "rv11 P0-09 FP1:",
      log.uriReference.compose.status,
      firstLine(log.uriReference.compose),
      log.uriReference.shell.status,
      firstLine(log.uriReference.shell),
    );
    expect(ran(log.uriReference.compose) && ran(log.uriReference.shell)).toBe(true);
  });
  it.fails("FALSE POSITIVE CHECK (P0-09 FP1, rule 5): a URI connection string whose password is a braced or bare variable reference passes", () => {
    expect({ compose: log.uriReference?.compose.status, shell: log.uriReference?.shell.status }).toEqual({
      compose: 0,
      shell: 0,
    });
  });
});
