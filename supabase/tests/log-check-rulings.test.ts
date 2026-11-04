/**
 * Builder tests for MJ's rulings on the log check (P0-09): the docs/log structure (MJ, 2026-11-04,
 * "All five cuts"), B-21 (supplier wording allowed under a
 * vault/ path segment, L-0080), narrowed by B-23 (not under any public/ directory) and B-24
 * (files with a UTF-32 byte-order mark are decoded and scanned), both L-0091.
 *
 * Same harness as the verifiers' files: each case is one commit in a throwaway clone (os tmpdir,
 * deleted afterwards) whose base carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * Example secrets are fake and assembled at run time. Nothing leaves the machine.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caseStem, NEXT_FILE, overlayWorktree, writeLogEntries } from "./log-check-harness";

const ROOT = resolve(import.meta.dirname, "../..");
// Each case clones the repository; a whole describe block may take minutes.
const LOG_CHECK_TIMEOUT_MS = 900_000;
// In a board row split on "|", the Status cell is the third piece from the end.
const STATUS_CELL_FROM_END = 3;
// Byte-order marks and code-unit width of the wide encodings the check decodes.
const BOM_CODE_POINT = 0xfeff;
const UTF32_BYTES = 4;
const UTF16_BOM_LE = "fffe";
const UTF16_BOM_BE = "feff";
// A board row's leading pipe: matches "| P0-02 | x", rejects "P0-02 | x".
// Tester: https://regex101.com/?regex=%5E%5C%7C%20&flavor=javascript&testString=%7C%20P0-02%20%7C%20x
const LEADING_PIPE = /^\| /;
// A board row's trailing pipe: matches "x |", rejects "x | y".
// Tester: https://regex101.com/?regex=%20%5C%7C%24&flavor=javascript&testString=x%20%7C
const TRAILING_PIPE = / \|$/;
// The P0-02 board row's last cell: matches "| x | C-001 |", rejects "| C-001 | x |".
// Tester: https://regex101.com/?regex=%5C%7C%20C-001%20%5C%7C%24&flavor=javascript&testString=%7C%20x%20%7C%20C-001%20%7C
const LAST_CELL_C001 = /\| C-001 \|$/;
// The kind closing a TASK header: matches "... branch t · TASK", rejects "**Task:** TASK x".
// Tester: https://regex101.com/?regex=TASK%24&flavor=javascript&testString=branch%20t%20%C2%B7%20TASK
const TASK_KIND = /TASK$/;
// The security checklist's lines: matches "Security checklist (tick):" and "[x] done", rejects "**Task:** x".
// Tester: https://regex101.com/?regex=ecurity%20checklist%7C%5E%5C%5Bx%5C%5D&flavor=javascript&testString=%5Bx%5D%20done
const CHECKLIST_LINE = /ecurity checklist|^\[x\]/;
const CHECKLIST = ["", "Security checklist (tick honestly):", '[x] No control weakened, skipped or "temporarily" disabled (H-16)', ""];
const ENTRY = [
  "# 2026-10-27 04:00 PKT · Tester · Model X · rulings-case · branch t · TASK",
  "**Task:** P0-09",
  "**What / why:** rulings case.",
  "**Evidence:** rulings case evidence.",
  "**Next / needs:** —",
  ...CHECKLIST,
];
// The stem a board row cites for a case's first log file (all the cases below are dated this day).
const STEM = caseStem("2026-10-27");
const FAKE_JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");

type Git = (...a: string[]) => string;
type Write = (rel: string, content: string | Buffer) => void;
// terms: KIRAN_SENSITIVE_TERMS for the run; after: further commits (merges, renames) after the case commit;
// seed: files, or edits, in the base commit before the case (an entry already merged, an older base).
type Opts = { terms?: string; after?: (g: Git, write: Write) => void; seed?: (dir: string, write: Write) => void };
function check(files: Record<string, string | Buffer>, entry: string[] = ENTRY, mutate?: (t: string) => string, removeLater: string[] = [], opts: Opts = {}): number | null {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rulings-"));
  try {
    const g: Git = (...a: string[]) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    overlayWorktree(ROOT, dir);
    const write: Write = (rel, content) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    opts.seed?.(dir, write);
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    writeLogEntries(dir, entry);
    const logPath = join(dir, "docs", "ACTIVITY.md");
    if (mutate) writeFileSync(logPath, mutate(readFileSync(logPath, "utf8")));
    Object.entries(files).forEach(([rel, content]) => {
      write(rel, content);
    });
    g("add", "-A");
    g("commit", "-q", "-m", "case");
    if (removeLater.length) { g("rm", "-q", ...removeLater); g("commit", "-q", "-m", "case: remove again"); }
    opts.after?.(g, write);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: opts.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    return spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const utf32 = (text: string, order: "le" | "be") => {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const b = Buffer.alloc(UTF32_BYTES * (cps.length + 1));
  const w = (v: number, i: number) => (order === "le" ? b.writeUInt32LE(v, i) : b.writeUInt32BE(v, i));
  w(BOM_CODE_POINT, 0);
  cps.forEach((cp, i) => w(cp, UTF32_BYTES * (i + 1)));
  return b;
};

describe("log check: MJ rulings B-21, B-23, B-24", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const row = 'type Row = { supplier_name: string };\nexport type { Row };\n';

  it("B-21 / B-23: supplier wording passes under vault/, but not under public/", () => {
    expect(check({ "apps/web/app/office/vault/suppliers/page.tsx": row })).toBe(0);
    expect(check({ "apps/web/public/vault/suppliers.ts": row })).toBe(1);
    expect(check({ "public/vault/x.ts": row })).toBe(1);
  });

  it("B-24: a JWT in a UTF-32 file (either byte order) is refused; honest UTF-32 text passes", () => {
    expect(check({ "apps/web/lib/u32le.txt": utf32(`k=${FAKE_JWT}\n`, "le") })).toBe(1);
    expect(check({ "apps/web/lib/u32be.txt": utf32(`k=${FAKE_JWT}\n`, "be") })).toBe(1);
    expect(check({ "apps/web/lib/u32ok.txt": utf32("greeting = salaam\n", "le") })).toBe(0);
  });
});

// Set the Status cell of one §12 board row.
const setStatus = (task: string, status: string) => (t: string) => t.split("\n").map((l) => {
  if (!l.startsWith(`| ${task} |`)) return l;
  const cells = l.split("|");
  cells[cells.length - STATUS_CELL_FROM_END] = ` ${status} `;
  return cells.join("|");
}).join("\n");
const verdict = (sig: string, type: string) => [
  `# 2026-10-27 04:00 PKT · ${sig} · ${type}`,
  "**Task:** P0-02",
  "**What / why:** rulings case verdict.",
  "**Evidence:** rulings case evidence.",
  "**Next / needs:** —",
  ...CHECKLIST,
];

describe("log check: board moves to VERIFIED (council audit finding 2)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const OTHER = "Tester · Model X · rulings-verifier · branch t";
  const BUILDER = "Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo)";

  it("a move to VERIFIED citing an independent verdict with the checklist passes, as VERIFIED or CORRECTION", () => {
    expect(check({}, verdict(OTHER, "VERIFIED"), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(0);
    expect(check({}, verdict(OTHER, "CORRECTION"), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(0);
  });

  it("refuses a move with no cited entry, citing the builder's own DONE, or a verdict by the maker", () => {
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED"))).toBe(1);
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED (L-0084)"))).toBe(1);
    expect(check({}, verdict(BUILDER, "CORRECTION"), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(1);
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED (L-9999)"))).toBe(1);
  });

  // MJ, L-0401: a builder may verify its own work, but the entry must say so. The unmarked
  // verdict by the maker above still fails; the same verdict with the line passes, and an
  // empty line does not count.
  const selfVerdict = (sig: string, type: string, line: string) => {
    const v = verdict(sig, type);
    const afterEvidence = v.findIndex((l) => l.startsWith("**Evidence:**")) + 1;
    v.splice(afterEvidence, 0, line);
    return v;
  };
  it("a verdict by the maker passes only with a non-empty Self-verification line (MJ, L-0401)", () => {
    const declared = "**Self-verification:** the builder verifies its own work (MJ, L-0401).";
    expect(check({}, selfVerdict(BUILDER, "CORRECTION", declared), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(0);
    expect(check({}, selfVerdict(BUILDER, "VERIFIED", declared), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(0);
    expect(check({}, selfVerdict(BUILDER, "VERIFIED", declared))).toBe(0);
    expect(check({}, verdict(BUILDER, "VERIFIED"))).toBe(1);
    expect(check({}, selfVerdict(BUILDER, "VERIFIED", "**Self-verification:**"), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(1);
    expect(check({}, selfVerdict(BUILDER, "VERIFIED", "Self-verification: unbolded"))).toBe(1);
  });
});

describe("log check: history pass (council audit finding 3)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("a secret or an env file added in one commit and removed in the next still fails", () => {
    expect(check({ "apps/web/lib/leak.txt": `k=${FAKE_JWT}\n` }, ENTRY, undefined, ["apps/web/lib/leak.txt"])).toBe(1);
    expect(check({ "apps/web/.envrc": "export X=1\n" }, ENTRY, undefined, ["apps/web/.envrc"])).toBe(1);
  });
  it("an honest file added and removed passes", () => {
    expect(check({ "apps/web/lib/tmp.ts": "export const a = 1;\n" }, ENTRY, undefined, ["apps/web/lib/tmp.ts"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Builder tests for the round-10 findings on P0-09 (L-0116 D1 to D8). Each fix has a refusal and
// an honest case that must still pass.
// ---------------------------------------------------------------------------------------------
const OTHER10 = "Tester · Model X · rulings-verifier · branch t";
const BUILDER10 = "Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo)";
// Rewrite one §12 board row (as the base file writes it).
const boardRow = (task: string, fn: (line: string) => string) => (t: string) =>
  t.split("\n").map((l) => (l.startsWith(`| ${task} |`) ? fn(l) : l)).join("\n");
const statusTo = (status: string) => (l: string) => {
  const cells = l.split("|");
  cells[cells.length - STATUS_CELL_FROM_END] = ` ${status} `;
  return cells.join("|");
};

describe("log check: board Status cells (L-0116 D1)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("refuses a status that renders as VERIFIED in any other spelling, cited or not", () => {
    ["verified", "**VERIFIED**", "​VERIFIED", "✅ VERIFIED", "ＶＥＲＩＦＩＥＤ", "VERIFIED"].forEach((s) => {
      expect(check({}, ENTRY, boardRow("P0-02", statusTo(s))), s).toBe(1);
    });
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo(`**VERIFIED (${STEM})**`)))).toBe(1);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo(`Verified (${STEM})`)))).toBe(1);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo(`VERIFIED (${STEM}) for now`)))).toBe(1);
    expect(check({}, ENTRY, boardRow("P0-02", statusTo("DONE (self-reported; VERIFIED soon)")))).toBe(1);
    expect(check({}, ENTRY, boardRow("P0-04", statusTo("IN PROGRESS ✅")))).toBe(1);
  });

  it("passes honest status changes, including a reopen note", () => {
    expect(check({}, ENTRY, boardRow("P0-04", statusTo(`DONE (self-reported; see ${STEM})`)))).toBe(0);
    expect(check({}, ENTRY, boardRow("P0-02", statusTo(`IN PROGRESS (reopened in ${STEM}; was VERIFIED L-0030)`)))).toBe(0);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo(`VERIFIED (${STEM})`)))).toBe(0);
  });
});

describe("log check: board rows read as GitHub renders tables (L-0116 D2, D3)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("finds an uncited move to VERIFIED in every valid row shape", () => {
    const v = (fn: (l: string) => string) => check({}, ENTRY, boardRow("P0-02", (l) => fn(statusTo("VERIFIED")(l))));
    expect(v((l) => "  " + l)).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "|P0-02|"))).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "| `P0-02` |"))).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "| P0–02 |"))).toBe(1);
    expect(v((l) => l + " x | y |")).toBe(1);
    expect(v((l) => l.replace(LEADING_PIPE, "").replace(TRAILING_PIPE, ""))).toBe(1);
    expect(v((l) => l.replace(LAST_CELL_C001, "| C-001 \\| x \\| y |"))).toBe(1);
  });

  it("passes a properly cited move written in another valid row shape", () => {
    const shaped = (l: string) => " " + statusTo(`VERIFIED (${STEM})`)(l).replace("| P0-02 |", "|**P0-02**|").replace(TRAILING_PIPE, "");
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", shaped))).toBe(0);
  });

  it("refuses a VERIFIED line that is not a recognisable task row", () => {
    // A look-alike id (letter O) added as a new row.
    expect(check({}, ENTRY, boardRow("P0-02", (l) => `${l}\n| PO-02 | x | y | VERIFIED | C-001 |`))).toBe(1);
    // A new table in the board whose header has no Status column (a task id not on the board, so
    // the duplicate-row rule is not what refuses it).
    expect(check({}, ENTRY, (t) => t.replace("### Phase 1 —", "| ID | State |\n|---|---|\n| P5-01 | VERIFIED |\n\n### Phase 1 —"))).toBe(1);
  });

  it("refuses a duplicate board row, even an exact copy", () => {
    expect(check({}, ENTRY, boardRow("P0-02", (l) => `${l}\n${l}`))).toBe(1);
    expect(check({}, ENTRY, boardRow("P0-02", (l) => `${statusTo("VERIFIED")(l)}\n${l}`))).toBe(1);
  });
});

describe("log check: a verdict must be newer than the task's latest DONE (L-0116 D4)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("refuses a reopened task citing a verdict from before its latest DONE", () => {
    expect(check({}, ENTRY, boardRow("P0-06", statusTo("VERIFIED (L-0030)")))).toBe(1);
    expect(check({}, ENTRY, boardRow("P1-01", statusTo("VERIFIED (L-0061)")))).toBe(1);
    const doneAfter = [
      ...verdict(OTHER10, "CORRECTION"),
      NEXT_FILE,
      `# 2026-10-27 05:00 PKT · ${BUILDER10} · TASK`,
      "**Task:** P0-02",
      "**What / why:** redone after the verdict.",
      "**Evidence:** rulings case evidence.",
      "**Next / needs:** —",
      ...CHECKLIST,
    ];
    expect(check({}, doneAfter, boardRow("P0-02", statusTo(`VERIFIED (${STEM})`)))).toBe(1);
  });
});

const JWT10 = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const utf16 = (s: string, order: "le" | "be", bom: boolean) => {
  const b = Buffer.from(s, "utf16le");
  if (order === "be") b.swap16();
  const mark = order === "le" ? UTF16_BOM_LE : UTF16_BOM_BE;
  return bom ? Buffer.concat([Buffer.from(mark, "hex"), b]) : b;
};
// A side branch merged with --no-ff; resolve() may add files to the merge commit itself.
const mergeWith = (resolve: (g: Git, write: Write) => void, removeAfter: string[] = []) => (g: Git, write: Write) => {
  // Name the case branch first: CI clones a detached commit, where --abbrev-ref HEAD is the
  // literal "HEAD" and checking it out again would stay on the side branch.
  const caseBranch = "rulings-case";
  g("checkout", "-q", "-B", caseBranch);
  g("checkout", "-q", "-B", "rulings-side");
  write("apps/web/side.txt", "side\n");
  g("add", "-A"); g("commit", "-q", "-m", "side");
  g("checkout", "-q", caseBranch);
  write("apps/web/main.txt", "main\n");
  g("add", "-A"); g("commit", "-q", "-m", "main");
  g("merge", "-q", "--no-ff", "--no-commit", "rulings-side");
  resolve(g, write);
  g("commit", "-q", "-m", "merge side");
  if (removeAfter.length) { g("rm", "-q", ...removeAfter); g("commit", "-q", "-m", "remove again"); }
};

describe("log check: history pass over merges, headers and wide encodings (L-0116 D5 to D7)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("D5: refuses a JWT or an env file added only in a merge resolution and removed later; a clean merge passes", () => {
    const leak = "apps/web/lib/merge-leak.txt";
    expect(check({}, ENTRY, undefined, [], { after: mergeWith((g, w) => { w(leak, `k=${JWT10}\n`); g("add", "-A"); }, [leak]) })).toBe(1);
    const env = "apps/web/.env.local";
    expect(check({}, ENTRY, undefined, [], { after: mergeWith((g, w) => { w(env, "X=1\n"); g("add", "-f", env); }, [env]) })).toBe(1);
    expect(check({}, ENTRY, undefined, [], { after: mergeWith(() => {}) })).toBe(0);
  });

  it("D6: refuses a secret on an added line starting '++ ' that a later commit removes", () => {
    expect(check({ "apps/web/lib/plus.txt": `++ ${JWT10}\n` }, ENTRY, undefined, ["apps/web/lib/plus.txt"])).toBe(1);
    expect(check({ "apps/web/lib/plus.txt": "++ just a note\n" }, ENTRY, undefined, ["apps/web/lib/plus.txt"])).toBe(0);
  });

  it("D7: refuses a UTF-16 (either order, BOM or not) or UTF-32 secret file added then removed; honest UTF-16 passes", () => {
    const f = "apps/web/lib/wide.txt";
    expect(check({ [f]: utf16(`k=${JWT10}\n`, "le", true) }, ENTRY, undefined, [f])).toBe(1);
    expect(check({ [f]: utf16(`k=${JWT10}\n`, "be", false) }, ENTRY, undefined, [f])).toBe(1);
    expect(check({ [f]: utf32(`k=${JWT10}\n`, "le") }, ENTRY, undefined, [f])).toBe(1);
    expect(check({ [f]: utf16("greeting = salaam\n", "le", true) }, ENTRY, undefined, [f])).toBe(0);
  });
});

describe("log check: owner terms in paths of every commit (L-0116 D8)", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const TERM = "Zentrivo"; // invented owner term
  const f = `apps/web/lib/${TERM.toLowerCase()}-notes.txt`;
  it("refuses a path with an owner term that is deleted or renamed away later", () => {
    expect(check({ [f]: "hello\n" }, ENTRY, undefined, [f], { terms: TERM })).toBe(1);
    expect(check({ [f]: "hello\n" }, ENTRY, undefined, [], { terms: TERM, after: (g) => { g("mv", f, "apps/web/lib/notes.txt"); g("commit", "-q", "-m", "rename"); } })).toBe(1);
  });
  it("passes honest paths with the owner terms set", () => {
    expect(check({ "apps/web/lib/notes.txt": "hello\n" }, ENTRY, undefined, ["apps/web/lib/notes.txt"], { terms: TERM })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The docs/log structure (MJ, 2026-11-04, "All five cuts"): one file per entry, one entry per
// task, a frozen archive, merged entries immutable, and new entries scanned like any other file.
// ---------------------------------------------------------------------------------------------
const ARCHIVE = "docs/log/archive.md";
const SEEDED = "docs/log/2026-10-20-seeded.md";
const SEEDED_TEXT = [...ENTRY, ""].join("\n").replace("2026-10-27 04:00", "2026-10-20 04:00");
const seedEntry: Opts = { seed: (_dir, write) => write(SEEDED, SEEDED_TEXT) };
const CODE = { "apps/web/lib/x.ts": "export const a = 1;\n" };
const withEvidence = (evidence: string[]) => ["# 2026-10-27 04:00 PKT · Tester · Model X · rulings-case · branch t · TASK", "**Task:** P0-09", "**What / why:** rulings case.", ...evidence, "**Next / needs:** —", ...CHECKLIST];
const kind = (k: string) => ENTRY.map((l, i) => (i === 0 ? l.replace(TASK_KIND, k) : l));

describe("log check: the archive is frozen", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("refuses a changed or deleted archive; an honest entry leaves it alone", () => {
    expect(check({})).toBe(0);
    const realArchive = readFileSync(join(ROOT, ARCHIVE), "utf8");
    expect(check({ [ARCHIVE]: `${realArchive}x\n` })).toBe(1);
    expect(check({ [ARCHIVE]: realArchive.replace("**Task:**", "**Task :**") })).toBe(1);
    expect(check({}, ENTRY, undefined, [ARCHIVE])).toBe(1);
  });

  it("while the base still holds the log in ACTIVITY.md, the archive must be its exact copy", () => {
    const realArchive = readFileSync(join(ROOT, ARCHIVE));
    const realActivity = readFileSync(join(ROOT, "docs", "ACTIVITY.md"));
    // A base from before the move: the entries inside section 16, no archive.
    const before: Opts = {
      seed: (dir) => {
        rmSync(join(dir, ARCHIVE));
        const text = realActivity.toString("utf8");
        const i = text.indexOf("---\n\n## Appendix A");
        writeFileSync(join(dir, "docs", "ACTIVITY.md"), text.slice(0, i) + realArchive.toString("utf8") + text.slice(i));
      },
    };
    expect(check({ [ARCHIVE]: realArchive, "docs/ACTIVITY.md": realActivity }, ENTRY, undefined, [], before)).toBe(0);
    const tampered = Buffer.from(realArchive.toString("utf8").replace("**Task:**", "**Task :**"));
    expect(check({ [ARCHIVE]: tampered, "docs/ACTIVITY.md": realActivity }, ENTRY, undefined, [], before)).toBe(1);
    expect(check({ "docs/ACTIVITY.md": realActivity }, ENTRY, undefined, [], { seed: before.seed })).toBe(1);
  });
});

describe("log check: merged entries are immutable", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("refuses changing, deleting or renaming a log file present in the base", () => {
    expect(check({}, ENTRY, undefined, [], seedEntry)).toBe(0);
    expect(check({ [SEEDED]: `${SEEDED_TEXT}more\n` }, ENTRY, undefined, [], seedEntry)).toBe(1);
    expect(check({}, ENTRY, undefined, [SEEDED], seedEntry)).toBe(1);
    expect(check({}, ENTRY, undefined, [], { ...seedEntry, after: (g) => { g("mv", SEEDED, "docs/log/2026-10-20-moved.md"); g("commit", "-q", "-m", "rename"); } })).toBe(1);
  });

  it("an entry not yet merged may be updated by adding to it", () => {
    const after = (g: Git, write: Write) => {
      write(`docs/log/${STEM}.md`, [...ENTRY, "More evidence after the next run.", ""].join("\n"));
      g("add", "-A");
      g("commit", "-q", "-m", "update the entry");
    };
    expect(check(CODE, ENTRY, undefined, [], { after })).toBe(0);
  });
});

describe("log check: a pull request that changes code needs evidence", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  it("refuses code or docs with no entry at all", () => {
    expect(check(CODE, [])).toBe(1);
    expect(check({ "docs/runbooks/x.md": "notes\n" }, [])).toBe(1);
    expect(check({}, [], (t) => t.replace("## 3. Claiming work\n", "## 3. Claiming work\n\nA note.\n"))).toBe(1);
  });

  it("refuses a code change whose entry has an empty Evidence section or no checklist", () => {
    expect(check(CODE, withEvidence([]))).toBe(1);
    expect(check(CODE, withEvidence(["**Evidence:**"]))).toBe(1);
    expect(check(CODE, withEvidence(["**Evidence:** —"]))).toBe(1);
    expect(check(CODE, withEvidence(["**Evidence:**", "", "   "]))).toBe(1);
    expect(check(CODE, ENTRY.filter((l) => !CHECKLIST_LINE.test(l)))).toBe(1);
    // A DECISION with no evidence does not cover code; it covers a docs-only change.
    const decision = kind("DECISION").filter((l) => !l.startsWith("**Evidence:**"));
    expect(check(CODE, decision)).toBe(1);
    expect(check({ "docs/runbooks/x.md": "notes\n" }, decision)).toBe(0);
  });

  it("accepts evidence on its own line or in following lines, fenced output included", () => {
    expect(check(CODE, withEvidence(["**Evidence:** pnpm lint exit 0"]))).toBe(0);
    expect(check(CODE, withEvidence(["**Evidence:**", "- pnpm lint exit 0"]))).toBe(0);
    expect(check(CODE, withEvidence(["**Evidence:**", "```text", "12 passed", "```"]))).toBe(0);
  });
});

describe("log check: new log files are scanned", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const TERM = "Zentrivo"; // invented owner term
  it("refuses a secret, a secret-named value, supplier wording or an owner term in a new log file", () => {
    expect(check({}, [...ENTRY, `Token was ${FAKE_JWT}.`, ""])).toBe(1);
    expect(check({}, [...ENTRY, "api_key = xK9mQ2vL7pR4tZ8w", ""])).toBe(1);
    expect(check({}, [...ENTRY, "The supplier_name column.", ""])).toBe(1);
    expect(check({}, [...ENTRY, `Bought from ${TERM}.`, ""], undefined, [], { terms: TERM })).toBe(1);
    expect(check({ "docs/log/2026-10-27-wide.md": utf16(`# x\n${FAKE_JWT}\n`, "le", true) })).toBe(1);
  });
  it("refuses an owner term in the file name, and a secret in an entry added then removed", () => {
    const named = `docs/log/2026-10-27-${TERM.toLowerCase()}.md`;
    expect(check({ [named]: [...ENTRY, ""].join("\n") }, ENTRY, undefined, [], { terms: TERM })).toBe(1);
    const leak = "docs/log/2026-10-27-leak.md";
    expect(check({ [leak]: [...ENTRY, FAKE_JWT, ""].join("\n") }, ENTRY, undefined, [leak])).toBe(1);
  });
  it("still passes the same words in other docs (supplier wording stays allowed there)", () => {
    expect(check({ "docs/runbooks/x.md": "The supplier_name column.\n" })).toBe(0);
  });
});

describe("log check: file names, headers and kinds", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const add = (rel: string, lines: string[] = ENTRY) => check({ [rel]: lines.join("\n") });
  it("refuses a badly named file in docs/log/", () => {
    expect(add("docs/log/notes.md")).toBe(1);
    expect(add("docs/log/2026-10-27-Bad_Name.md")).toBe(1);
    expect(add("docs/log/2026-10-27-.md")).toBe(1);
    expect(add("docs/log/2026-10-27-nested/entry.md")).toBe(1);
    expect(add("docs/log/2026-10-27-fine-2.txt")).toBe(1);
    expect(add("docs/log/2026-10-27-fine-2.md")).toBe(0);
  });
  it("refuses a header that is missing, dated differently from the name, or a second header", () => {
    expect(add("docs/log/2026-10-28-other-date.md")).toBe(1);
    expect(check({}, ENTRY.slice(1))).toBe(1);
    expect(check({}, [...ENTRY, "# 2026-10-27 05:00 PKT · MJ · human · owner sign-off · VERIFIED", ""])).toBe(1);
    expect(check({}, ["### L-0999 · 2026-10-27 04:00 PKT · Tester · Model X · t · PROGRESS", ...ENTRY.slice(1)])).toBe(1);
  });
  it("refuses the retired entry kinds and accepts the ones that stay", () => {
    ["SESSION-START", "CLAIM", "CLAIM-RELEASED", "DONE", "PROGRESS", "HANDOFF", "NOPE"].forEach((k) => {
      expect(check({}, kind(k)), k).toBe(1);
    });
    ["DECISION", "BLOCKER", "ASSUMPTION", "DEVIATION", "CORRECTION", "SECURITY-INCIDENT"].forEach((k) => {
      expect(check({}, kind(k)), k).toBe(0);
    });
  });
  it("refuses a log entry put back into ACTIVITY.md", () => {
    const put = (l: string) => (t: string) => t.replace("## 13. Active claims\n", `## 13. Active claims\n\n${l}\n`);
    expect(check({}, ENTRY, put("### L-0421 · 2026-10-27 04:00 PKT · Tester · Model X · t · DECISION"))).toBe(1);
    expect(check({}, ENTRY, put("# 2026-10-27 04:00 PKT · Tester · Model X · t · DECISION"))).toBe(1);
  });
});

describe("log check: verification in docs/log", { timeout: LOG_CHECK_TIMEOUT_MS }, () => {
  const BUILDER = "Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo)";
  const declared = "**Self-verification:** the builder verifies its own work (MJ, L-0401).";
  const selfTask = (sig: string, line: string[]) => {
    const v = verdict(sig, "TASK");
    v.splice(v.findIndex((l) => l.startsWith("**Evidence:**")) + 1, 0, ...line);
    return v;
  };
  it("a VERIFIED docs/log entry with a Self-verification line is accepted; the task's own entry is not a verdict", () => {
    expect(check({}, selfTask(BUILDER, [declared]).map((l, i) => (i === 0 ? l.replace(TASK_KIND, "VERIFIED") : l)), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(0);
    expect(check({}, selfTask(BUILDER, [declared]), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(1);
  });
  it("a TASK entry without that line cannot verify, nor can a DECISION or a missing stem", () => {
    expect(check({}, selfTask(BUILDER, []), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(1);
    expect(check({}, verdict("Tester · Model X · rulings-case · branch t", "DECISION"), setStatus("P0-02", `VERIFIED (${STEM})`))).toBe(1);
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED (2026-10-27-no-such-entry)"))).toBe(1);
  });
  it("a verdict needs the checklist and a task with work to verify; a task entry later than the archive counts as work", () => {
    const other = "Tester · Model X · rulings-verifier · branch t";
    expect(check({}, verdict(other, "VERIFIED").filter((l) => !CHECKLIST_LINE.test(l)))).toBe(1);
    expect(check({}, verdict(other, "VERIFIED").map((l) => l.replace("P0-02", "P5-01")))).toBe(1);
    const taskThenVerdict = [...verdict(BUILDER, "TASK").map((l) => l.replace("P0-02", "P5-01")), NEXT_FILE, ...verdict(other, "VERIFIED").map((l) => l.replace("P0-02", "P5-01").replace("04:00", "05:00"))];
    expect(check({}, taskThenVerdict)).toBe(0);
  });
});
