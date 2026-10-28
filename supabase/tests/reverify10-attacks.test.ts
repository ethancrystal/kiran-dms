/**
 * Tenth re-verification (ACTIVITY §7, L-0110 / L-0115) of P0-06 (RLS harness and schema guards,
 * L-0113), P1-01 (device state guard, migration 0007, L-0112) and the protocol log check P0-09
 * (scripts/activity-log-check.mjs after L-0105, Appendix C after L-0107). Written by the
 * re-verifier-10 workflow, not the builder. P0-02 is probed in
 * packages/import/tests/reverify10-import.test.ts.
 *
 * Database part: every case runs as postgres (or a fixture persona) inside one transaction that
 * is always rolled back. The schema-hygiene guard queries (AUDIT_GAPS, VIEW_GAPS, SCHEMA_GAPS)
 * and the matrix comparison are read from the WORKTREE test files at run time, so a builder fix
 * there flips these checks green with no edits here.
 *
 * Log-check part: same harness as reverify9 / log-check-rulings. Each case is a throwaway clone
 * (os tmpdir, deleted afterwards) whose base commit carries the WORKTREE script and log, checked
 * with  node scripts/activity-log-check.mjs <base> HEAD . Nothing leaves the machine; no
 * Supabase project, GitHub or MCP tool is touched. DATABASE_URL / KIRAN_TEST_DATABASE_URL are
 * stripped from the child env. Secret-shaped strings are fake and assembled at run time; the
 * owner term is invented.
 *
 * "DEFECT CHECK" states the secure expectation: a failure is a defect in the code under test,
 * not a broken test. "FALSE POSITIVE CHECK" is honest work that must pass. "CONTROL" and
 * "OBSERVATION" pass either way. Do not loosen these.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fx, run, sqlstate } from "./helpers/db";

const ROOT = resolve(import.meta.dirname, "../..");

// ---------------------------------------------------------------------------------------------
// Database part (P0-06 guards, P1-01 device guard)
// ---------------------------------------------------------------------------------------------
const HYG = readFileSync(join(import.meta.dirname, "schema-hygiene.test.ts"), "utf8");
const MATRIX_SRC = readFileSync(join(import.meta.dirname, "rls-matrix.test.ts"), "utf8");
const SCHEMAS = (HYG.match(/const SCHEMAS = "([^"]+)";/) ?? [])[1] ?? "";
const guard = (name: string) => {
  const m = HYG.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;"));
  if (!m) throw new Error(`guard ${name} not found in schema-hygiene.test.ts`);
  const q = m[1].replaceAll("${SCHEMAS}", SCHEMAS);
  if (q.includes("${")) throw new Error(`guard ${name} has an interpolation this harness does not know`);
  return q;
};
const AUDIT_GAPS = guard("AUDIT_GAPS");
const VIEW_GAPS = guard("VIEW_GAPS");
const SCHEMA_GAPS = guard("SCHEMA_GAPS");
// Setup statements plus a guard in one rolled-back transaction; returns the guard's rows.
const planted = async (setup: string, q: string) => {
  const res = (await run("postgres", `${setup}; ${q}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
  return res[res.length - 1].rows.map((r) => r.t);
};
const rowsOf = (res: unknown) => (res as Array<{ rows: Array<Record<string, unknown>> }>).map((r) => r.rows);

describe("P0-06 guards and P1-01 device guard (re-verifier-10)", () => {
  it("CONTROL: the guards are clean on the real schema and still catch the planted shapes the builder tested", async () => {
    expect((await run("postgres", AUDIT_GAPS)).rows).toEqual([]);
    expect((await run("postgres", VIEW_GAPS)).rows).toEqual([]);
    expect((await run("postgres", SCHEMA_GAPS)).rows).toEqual([]);
    expect(await planted("alter table public.app_config disable trigger audit", AUDIT_GAPS)).toEqual(["public.app_config"]);
    expect(await planted("create schema zz_rv10_ctrl; create table zz_rv10_ctrl.t (id int)", SCHEMA_GAPS)).toEqual(["zz_rv10_ctrl"]);
  });

  // DEFECT (V-B26-1; L-0112 / L-0113 checklists say the guard checks the audit trigger "fires on
  // every operation"; the test comment says a trigger that "skips an operation" fails). AUDIT_GAPS
  // reads only tgenabled and the tgtype bits. It ignores tgqual (a WHEN clause) and tgattr (an
  // UPDATE OF column list), so a trigger that never fires, or fires only when one column changes,
  // passes. Latent: no real audit trigger has either today. Fix suggested by the verifier:
  //   and tg.tgqual is null and tg.tgattr = ''::int2vector
  it("DEFECT CHECK (H-17): AUDIT_GAPS passes an audit trigger with WHEN (false) or an UPDATE OF column list", async () => {
    const swap = (spec: string, when = "") => `drop trigger audit on public.app_config;
      create trigger audit ${spec} on public.app_config for each row ${when}execute function control.audit_row()`;
    const whenFalse = await planted(swap("after insert or update or delete", "when (false) "), AUDIT_GAPS);
    const updateOf = await planted(swap("after insert or update of note or delete"), AUDIT_GAPS);
    // Evidence that the WHEN (false) trigger audits nothing (counts only; logged).
    const demo = rowsOf(await run("postgres", `${swap("after insert or update or delete", "when (false) ")};
      select count(*)::int n from control.audit_event;
      update public.app_config set note = coalesce(note, '') || ' rv10';
      select count(*)::int n from control.audit_event`));
    console.log("rv10 P0-06 D1 (whenFalse gaps, updateOf gaps, audit_event before/after):",
      JSON.stringify(whenFalse), JSON.stringify(updateOf), demo[2][0]?.n, demo[4][0]?.n);
    expect({ whenFalse, updateOf }).toEqual({ whenFalse: ["public.app_config"], updateOf: ["public.app_config"] });
  });

  // DEFECT (V-B26-2; rls-matrix.test.ts header: "The persona must see exactly the rows the
  // predicate selects"). The SELECT cell compares only count(*), so a policy that shows a persona
  // other rows in the same number passes. The live demonstration below (logged) swaps repA's uid
  // for repB's in device_select; the ASSERTION is on the matrix source and is the part that flips
  // when the comparison checks row identity. Not a live leak: today's policies are not shown wrong.
  it("DEFECT CHECK (H-13): the RLS matrix SELECT check compares counts only, so a same-count cross-user leak passes", async () => {
    const A = fx.repA.id, B = fx.repB.id;
    const demo = rowsOf(await run("postgres", `
      alter policy device_select on public.device using (
        (user_id = (case when (select auth.uid()) = '${A}'::uuid then '${B}'::uuid else (select auth.uid()) end)
         and (select app.self_ok())) or (select app.is_office()));
      select count(*)::int n from public.device where user_id = '${A}';
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: A, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;
      select count(*)::int n from public.device;
      select count(*)::int n from public.device where user_id = '${A}'`));
    const res = { want: demo[1][0]?.n, got: demo[4][0]?.n, gotOwn: demo[5][0]?.n };
    console.log("rv10 P0-06 D2 demo (want, got, gotOwn):", JSON.stringify(res));
    const countOnly = /const got = await run\(who, `select count\(\*\)::int as n from \$\{row\.table\}`\);\s*expect\(got\.rows\[0\]\.n\)\.toBe\(want\.rows\[0\]\.n\);/.test(MATRIX_SRC);
    expect({ countOnly }).toEqual({ countOnly: false });
  });

  // DEFECT (V-B26-3; L-0113: "no schema created by the migration role may exist outside the
  // guarded list"; council finding 4 covers "tables in the exposed schemas"). config.toml exposes
  // graphql_public, which SCHEMA_GAPS skips by name and which is outside SCHEMAS and the matrix
  // COVERAGE; and the guard filters on nspowner = current_user, so a schema created with
  // AUTHORIZATION another role escapes it. (The extensions schema is a disclosed exclusion, not a
  // defect.) Reachability on hosted Supabase is unverified; CI runs this same harness.
  it("DEFECT CHECK (H-13): a table in graphql_public, or in a schema created AUTHORIZATION service_role, escapes SCHEMA_GAPS", async () => {
    // Builder change under MJ approval (L-0125): on the Supabase stack the migration role has no
    // CREATE right on graphql_public, so planting there errors; in that environment the refusal
    // itself is the protection and is asserted instead. Everything else in this test is unchanged.
    const { rows: [gqlPriv] } = await run("postgres", "select not exists (select 1 from pg_namespace where nspname = 'graphql_public') or has_schema_privilege(current_user, 'graphql_public', 'CREATE') as can_create");
    const gql = gqlPriv.can_create
      ? await planted("create schema if not exists graphql_public; create table graphql_public.zz_rv10_t (id int); grant select on graphql_public.zz_rv10_t to anon", SCHEMA_GAPS)
      : ((await sqlstate("postgres", "create table graphql_public.zz_rv10_t (id int)")) === "42501" ? ["graphql_public"] : []);
    const other = await planted("create schema zz_rv10_other authorization service_role; create table zz_rv10_other.t (id int)", SCHEMA_GAPS);
    const res = { graphqlPublicSeen: gql.includes("graphql_public") || SCHEMAS.includes("'graphql_public'"), otherOwnerSeen: other.includes("zz_rv10_other") };
    console.log("rv10 P0-06 D3 (graphql_public gaps, other-owner gaps):", JSON.stringify(gql), JSON.stringify(other));
    expect(res).toEqual({ graphqlPublicSeen: true, otherOwnerSeen: true });
  });

  // FALSE POSITIVE (V-B26-6). VIEW_GAPS accepts only the stored spellings security_invoker=true and
  // =on. Postgres keeps 1, yes, t and y as written, so a view that does run with invoker rights is
  // flagged. Fails closed; no hole. No migration creates a view today.
  it("FALSE POSITIVE CHECK: VIEW_GAPS flags a view declared security_invoker = 1 or = yes", async () => {
    const one = await planted("create view public.zz_rv10_v with (security_invoker = 1) as select 1 as x", VIEW_GAPS);
    const yes = await planted("create view public.zz_rv10_v with (security_invoker = yes) as select 1 as x", VIEW_GAPS);
    console.log("rv10 P0-06 FP1 (=1, =yes):", JSON.stringify(one), JSON.stringify(yes));
    expect({ one, yes }).toEqual({ one: [], yes: [] });
  });

  // OBSERVATION (V-B26-5; evidence for B-17, not a new defect). device_guard (migration 0007) is a
  // BEFORE UPDATE row trigger, so TRUNCATE by the table owner skips it: a revoked row is removed and
  // the same user and fingerprint come back as approved. Application roles get 42501 on TRUNCATE.
  // The 0007 header and doc 04 say the rule binds table owners; the owner can also disable the
  // trigger, so this gives no new power.
  it("OBSERVATION: the table owner can TRUNCATE public.device and re-insert a revoked fingerprint as approved", async () => {
    const M = fx.manager.id;
    let outcome: string;
    try {
      const r = rowsOf(await run("postgres", `
        create temp table rv10_old on commit drop as
          select * from public.device where user_id = '${fx.repA.id}' and status = 'approved' limit 1;
        update public.device set status = 'revoked', revoked_by = '${M}', revoked_at = now() where id = (select id from rv10_old);
        truncate public.device cascade;
        insert into public.device (user_id, device_fingerprint, status, approved_by, approved_at)
          select user_id, device_fingerprint, 'approved', '${M}', now() from rv10_old;
        select status::text s from public.device where (user_id, device_fingerprint) = (select user_id, device_fingerprint from rv10_old)`));
      outcome = `revived as ${r[4][0]?.s ?? "nothing"}`;
    } catch (e) {
      outcome = `refused: ${(e as Error).message}`;
    }
    console.log("rv10 P1-01 O1 (owner truncate then re-insert):", outcome);
    expect(typeof outcome).toBe("string");
  });
});

// ---------------------------------------------------------------------------------------------
// Log-check part (P0-09)
// ---------------------------------------------------------------------------------------------
const OTHER = "Tester · Model X · rv10-case-agent · branch t";
const entry = (type: string, task: string, sig = OTHER) => [
  `### L-NEXT · 2026-10-28 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}    **Claim:** —`,
  "**What / why:** rv10 case.",
  "**Evidence:** rv10 case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  ...(["DONE", "VERIFIED", "CORRECTION"].includes(type)
    ? ["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"]
    : []),
  "",
];
const P = entry("PROGRESS", "P0-09");
// Fake values, assembled at run time.
const FAKE_JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const TERM = "Quorvexa"; // invented owner term

type G = (...a: string[]) => string;
type Case = {
  lines?: string[];
  mutate?: (text: string) => string;
  files?: Record<string, string | Buffer>;
  terms?: string;
  // Further commits after the case commit (add-then-remove, renames, merges).
  after?: (g: G, write: (rel: string, content: string | Buffer) => void) => void;
};
function check(c: Case): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv10-log-"));
  try {
    const g: G = (...a) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv10", "-c", "user.email=rv10@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const write = (rel: string, content: string | Buffer) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv10 base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    const logPath = join(dir, "docs", "ACTIVITY.md");
    const all = readFileSync(logPath, "utf8").split("\n");
    const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
    const next = `L-${String(Number(all[last].slice(6, 10)) + 1).padStart(4, "0")}`;
    let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
    while (all[sep].trim() !== "---") sep--;
    all.splice(sep, 0, ...(c.lines ?? P));
    let text = all.join("\n");
    if (c.mutate) text = c.mutate(text);
    writeFileSync(logPath, text.replaceAll("L-NEXT", next));
    for (const [rel, content] of Object.entries(c.files ?? {})) write(rel, content);
    g("add", "-A");
    g("commit", "-q", "-m", "rv10 case");
    c.after?.(g, write);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Rewrite the §12 board row of one task (the row as the base file writes it).
const row = (task: string, fn: (line: string) => string) => (t: string) =>
  t.split("\n").map((l) => (l.startsWith(`| ${task} |`) ? fn(l) : l)).join("\n");
const withStatus = (status: string) => (l: string) => {
  const cells = l.split("|");
  cells[cells.length - 3] = ` ${status} `;
  return cells.join("|");
};
const setStatus = (task: string, status: string) => row(task, withStatus(status));
const removeAgain = (...rels: string[]) => (g: G) => { g("rm", "-q", ...rels); g("commit", "-q", "-m", "rv10 case: remove again"); };
const utf16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
const utf32le = (s: string) => {
  const cps = [...s].map((ch) => ch.codePointAt(0)!);
  const b = Buffer.alloc(4 * (cps.length + 1));
  b.writeUInt32LE(0xfeff, 0);
  cps.forEach((cp, i) => b.writeUInt32LE(cp, 4 * (i + 1)));
  return b;
};
const verifierId = (() => {
  const m = [...readFileSync(join(ROOT, "docs", "ACTIVITY.md"), "utf8").matchAll(/^### (L-\d{4}) · [^\n]*re-verifier-10 workflow[^\n]*$/gm)];
  return m.length ? m[m.length - 1][1] : null;
})();

describe("activity-log-check P0-09 board rule 4b (re-verifier-10)", { timeout: 900_000 }, () => {
  it("CONTROL: an uncited move is refused; this verifier's entry satisfies rule 4b for P1-01", () => {
    expect(check({ mutate: setStatus("P0-09", "VERIFIED") }).status).toBe(1);
    expect(verifierId, "the re-verifier-10 entry must be in docs/ACTIVITY.md").not.toBeNull();
    const cite = check({ mutate: setStatus("P1-01", `VERIFIED (${verifierId})`) });
    console.log("rv10 control (P1-01 citing the re-verifier-10 entry):", cite.status, cite.out.split("\n")[0]);
    expect(cite.status).toBe(0);
  });

  // DEFECT D1 (rule 4b, H-25). The move test is /^VERIFIED\b/ on a cell that only gets an ASCII
  // trim: case-sensitive, anchored, and not normalised (no NFKC, no zero-width removal, no
  // Markdown emphasis). A cell that renders as VERIFIED in any other form skips every check.
  it("DEFECT CHECK (rule 4b): a status that renders as VERIFIED in another form moves without a cited verdict", () => {
    const res = Object.fromEntries(([
      ["lower", "verified"],
      ["bold", "**VERIFIED**"],
      ["zwsp", "​VERIFIED"],
      ["emoji", "✅ VERIFIED"],
      ["fullwidth", "ＶＥＲＩＦＩＥＤ"],
    ] as const).map(([k, s]) => [k, check({ mutate: setStatus("P0-09", s) }).status]));
    console.log("rv10 P0-09 D1:", JSON.stringify(res));
    expect(res).toEqual({ lower: 1, bold: 1, zwsp: 1, emoji: 1, fullwidth: 1 });
  });

  // DEFECT D2 (rule 4b, H-25). boardOf() matches only a row written exactly "| Pn-nn |" at
  // column 0 and reads Status as cells[length-3]. GFM also renders an indented row, "|P0-09 |",
  // a bold id, a row with an extra trailing cell (dropped), a row without the trailing pipe, and an
  // escaped pipe inside a cell; in each, the Status column shows VERIFIED unchecked.
  it("DEFECT CHECK (rule 4b): other valid table-row shapes hide a move to VERIFIED", () => {
    const v = (fn: (l: string) => string) => check({ mutate: row("P0-09", (l) => fn(withStatus("VERIFIED")(l))) }).status;
    const res = {
      leadingSpace: v((l) => " " + l),
      noSpace: v((l) => l.replace("| P0-09 |", "|P0-09 |")),
      boldId: v((l) => l.replace("| P0-09 |", "| **P0-09** |")),
      extraCell: v((l) => l + " x |"),
      noTrailingPipe: v((l) => l.replace(/ \|$/, "")),
      escapedPipe: v((l) => l.replace(/\| C-001 \|$/, "| C-001 \\| x |")),
    };
    console.log("rv10 P0-09 D2:", JSON.stringify(res));
    expect(res).toEqual({ leadingSpace: 1, noSpace: 1, boldId: 1, extraCell: 1, noTrailingPipe: 1, escapedPipe: 1 });
  });

  // DEFECT D3 (rule 4b). boardOf() keeps the LAST row per task in a Map, so a first row reading
  // VERIFIED is never checked when a second row with the old status follows it.
  it("DEFECT CHECK (rule 4b): a duplicate board row hides an uncited VERIFIED row", () => {
    const dup = check({ mutate: row("P0-09", (l) => `${withStatus("VERIFIED")(l)}\n${l}`) });
    console.log("rv10 P0-09 D3:", dup.status);
    expect(dup.status).toBe(1);
  });

  // DEFECT D4 (rule 4b; §7, MJ L-0110 "then a fresh verification"). The cited verdict may be older
  // than the task's latest DONE entry: reopened P0-06 (DONE L-0113) and P1-01 (DONE L-0112) go back
  // to VERIFIED citing the verdicts from before the reopen (L-0030, L-0061).
  it("DEFECT CHECK (rule 4b): a reopened task moves back to VERIFIED citing a verdict older than its latest DONE", () => {
    const res = {
      p006: check({ mutate: setStatus("P0-06", "VERIFIED (L-0030)") }).status,
      p101: check({ mutate: setStatus("P1-01", "VERIFIED (L-0061)") }).status,
    };
    console.log("rv10 P0-09 D4:", JSON.stringify(res));
    expect(res).toEqual({ p006: 1, p101: 1 });
  });

  // OBSERVATION O1 (spec gap, Appendix C rule 4 as written). A board row can cite a CORRECTION
  // that rejects the task: L-0030 says "P1-01 and P0-09 are not VERIFIED", yet cites cleanly.
  it("OBSERVATION: a board row may cite a CORRECTION entry that rejects the task", () => {
    const r = check({ mutate: setStatus("P0-09", "VERIFIED (L-0030)") });
    console.log("rv10 P0-09 O1 (P0-09 citing L-0030):", r.status);
    expect(typeof r.status).toBe("number");
  });
});

describe("activity-log-check P0-09 history pass (re-verifier-10)", { timeout: 900_000 }, () => {
  // DEFECT D5 (rule 5, H-25: "every commit in the range"). Both history scans use --no-merges, so
  // a secret or an env file added only in a merge commit's resolution, and removed by a later
  // commit, is never seen. Plain `git log -p` shows no diff for merges either; the verifier
  // suggests --diff-merges=first-parent (or -m) on both git log calls.
  it("DEFECT CHECK (rule 5): a JWT or an env file added only in a merge resolution and removed later passes", () => {
    const mergeCase = (leak: string, content: string, force = false) => check({
      after: (g, write) => {
        const caseBranch = g("rev-parse", "--abbrev-ref", "HEAD").trim();
        g("checkout", "-q", "-B", "rv10-side");
        write("apps/web/side.txt", "side\n");
        g("add", "-A"); g("commit", "-q", "-m", "side");
        g("checkout", "-q", caseBranch);
        write("apps/web/main.txt", "main\n");
        g("add", "-A"); g("commit", "-q", "-m", "main");
        g("merge", "-q", "--no-ff", "--no-commit", "rv10-side");
        write(leak, content);
        if (force) g("add", "-f", leak); else g("add", "-A");
        g("commit", "-q", "-m", "merge side");
        g("rm", "-q", leak); g("commit", "-q", "-m", "remove again");
      },
    }).status;
    const res = {
      jwt: mergeCase("apps/web/lib/leak.txt", `k=${FAKE_JWT}\n`),
      env: mergeCase("apps/web/.env.local", "SUPABASE_URL=http://127.0.0.1:54321\n", true),
    };
    console.log("rv10 P0-09 D5:", JSON.stringify(res));
    expect(res).toEqual({ jwt: 1, env: 1 });
  });

  // DEFECT D6 (rule 5, H-25). The history parser skips every diff line starting "+++ " with no
  // header state, so an added content line that starts "++ " is never scanned there (the net-diff
  // parser tracks headers and does see it). Owner terms on such lines are skipped the same way.
  it("DEFECT CHECK (rule 5): a secret on a line starting '++ ', added then removed, passes", () => {
    const r = check({ files: { "apps/web/lib/plus.txt": `++ ${FAKE_JWT}\n` }, after: removeAgain("apps/web/lib/plus.txt") });
    console.log("rv10 P0-09 D6:", r.status);
    expect(r.status).toBe(1);
  });

  // DEFECT D7 (rule 5, H-25). UTF-16 / UTF-32 decoding runs only on files in the net diff; the
  // history pass sees interleaved NUL bytes. A UTF-16 or UTF-32 file holding a secret in an
  // intermediate commit and deleted later passes (Windows PowerShell 5 redirection writes UTF-16LE).
  it("DEFECT CHECK (rule 5): a UTF-16LE or UTF-32LE secret file added then removed passes", () => {
    const res = {
      u16: check({ files: { "apps/web/lib/u16.txt": utf16le(`k=${FAKE_JWT}\n`) }, after: removeAgain("apps/web/lib/u16.txt") }).status,
      u32: check({ files: { "apps/web/lib/u32.txt": utf32le(`k=${FAKE_JWT}\n`) }, after: removeAgain("apps/web/lib/u32.txt") }).status,
    };
    console.log("rv10 P0-09 D7:", JSON.stringify(res));
    expect(res).toEqual({ u16: 1, u32: 1 });
  });

  // DEFECT D8 (rule 5, H-25: owner terms apply "in added lines and in file paths" and "to every
  // commit in the range"). The path check runs on the net diff only, so a path holding an owner
  // term that is added and later deleted, or renamed away, passes.
  it("DEFECT CHECK (rule 5): an owner term in a file path, added then deleted or renamed away, passes", () => {
    const f = `apps/web/lib/${TERM.toLowerCase()}-notes.txt`;
    const res = {
      removed: check({ terms: TERM, files: { [f]: "hello\n" }, after: removeAgain(f) }).status,
      renamed: check({ terms: TERM, files: { [f]: "hello\n" }, after: (g) => { g("mv", f, "apps/web/lib/notes.txt"); g("commit", "-q", "-m", "rename"); } }).status,
    };
    console.log("rv10 P0-09 D8:", JSON.stringify(res));
    expect(res).toEqual({ removed: 1, renamed: 1 });
  });
});
