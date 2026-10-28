/**
 * Builder tests for MJ's rulings on the log check (P0-09): B-21 (supplier wording allowed under a
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

const ROOT = resolve(import.meta.dirname, "../..");
const ENTRY = [
  "### L-NEXT · 2026-10-27 04:00 PKT · Tester · Model X · rulings-case · branch t · PROGRESS",
  "**Task:** P0-09    **Claim:** —",
  "**What / why:** rulings case.",
  "**Evidence:** rulings case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  "",
];
const FAKE_JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");

type Git = (...a: string[]) => string;
type Write = (rel: string, content: string | Buffer) => void;
// terms: KIRAN_SENSITIVE_TERMS for the run; after: further commits (merges, renames) after the case commit.
type Opts = { terms?: string; after?: (g: Git, write: Write) => void };
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
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    const logPath = join(dir, "docs", "ACTIVITY.md");
    const all = readFileSync(logPath, "utf8").split("\n");
    const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
    const next = `L-${String(Number(all[last].slice(6, 10)) + 1).padStart(4, "0")}`;
    let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
    while (all[sep].trim() !== "---") sep--;
    // L-NEXT is the next entry number, L-NEXT1 the one after it.
    const next1 = `L-${String(Number(next.slice(2)) + 1).padStart(4, "0")}`;
    const ids = (l: string) => l.replaceAll("L-NEXT1", next1).replaceAll("L-NEXT", next);
    all.splice(sep, 0, ...entry.map(ids));
    let text = all.join("\n");
    if (mutate) text = ids(mutate(text));
    writeFileSync(logPath, text);
    const write: Write = (rel, content) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    };
    for (const [rel, content] of Object.entries(files)) write(rel, content);
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
  const b = Buffer.alloc(4 * (cps.length + 1));
  const w = (v: number, i: number) => (order === "le" ? b.writeUInt32LE(v, i) : b.writeUInt32BE(v, i));
  w(0xfeff, 0);
  cps.forEach((cp, i) => w(cp, 4 * (i + 1)));
  return b;
};

describe("log check: MJ rulings B-21, B-23, B-24", { timeout: 300_000 }, () => {
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
  cells[cells.length - 3] = ` ${status} `;
  return cells.join("|");
}).join("\n");
const verdict = (sig: string, type: string) => [
  `### L-NEXT · 2026-10-27 04:00 PKT · ${sig} · ${type}`,
  "**Task:** P0-02    **Claim:** —",
  "**What / why:** rulings case verdict.",
  "**Evidence:** rulings case evidence.",
  "**Rules touched:** §7",
  "**Next / needs:** —",
  "",
  "Security checklist (tick honestly):",
  '[x] No control weakened, skipped or "temporarily" disabled (H-16)',
  "",
];

describe("log check: board moves to VERIFIED (council audit finding 2)", { timeout: 300_000 }, () => {
  const OTHER = "Tester · Model X · rulings-verifier · branch t";
  const BUILDER = "Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo)";

  it("a move to VERIFIED citing an independent verdict with the checklist passes, as VERIFIED or CORRECTION", () => {
    expect(check({}, verdict(OTHER, "VERIFIED"), setStatus("P0-02", "VERIFIED (L-NEXT)"))).toBe(0);
    expect(check({}, verdict(OTHER, "CORRECTION"), setStatus("P0-02", "VERIFIED (L-NEXT)"))).toBe(0);
  });

  it("refuses a move with no cited entry, citing the builder's own DONE, or a verdict by the maker", () => {
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED"))).toBe(1);
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED (L-0084)"))).toBe(1);
    expect(check({}, verdict(BUILDER, "CORRECTION"), setStatus("P0-02", "VERIFIED (L-NEXT)"))).toBe(1);
    expect(check({}, ENTRY, setStatus("P0-02", "VERIFIED (L-9999)"))).toBe(1);
  });
});

describe("log check: history pass (council audit finding 3)", { timeout: 300_000 }, () => {
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
  cells[cells.length - 3] = ` ${status} `;
  return cells.join("|");
};

describe("log check: board Status cells (L-0116 D1)", { timeout: 900_000 }, () => {
  it("refuses a status that renders as VERIFIED in any other spelling, cited or not", () => {
    for (const s of ["verified", "**VERIFIED**", "​VERIFIED", "✅ VERIFIED", "ＶＥＲＩＦＩＥＤ", "VERIFIED"]) {
      expect(check({}, ENTRY, boardRow("P0-02", statusTo(s))), s).toBe(1);
    }
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo("**VERIFIED (L-NEXT)**")))).toBe(1);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo("Verified (L-NEXT)")))).toBe(1);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo("VERIFIED (L-NEXT) for now")))).toBe(1);
    expect(check({}, ENTRY, boardRow("P0-02", statusTo("DONE (self-reported; VERIFIED soon)")))).toBe(1);
    expect(check({}, ENTRY, boardRow("P0-04", statusTo("IN PROGRESS ✅")))).toBe(1);
  });

  it("passes honest status changes, including a reopen note", () => {
    expect(check({}, ENTRY, boardRow("P0-04", statusTo("DONE (self-reported; see L-NEXT)")))).toBe(0);
    expect(check({}, ENTRY, boardRow("P0-02", statusTo("IN PROGRESS (reopened in L-NEXT; was VERIFIED L-0030)")))).toBe(0);
    expect(check({}, verdict(OTHER10, "CORRECTION"), boardRow("P0-02", statusTo("VERIFIED (L-NEXT)")))).toBe(0);
  });
});

describe("log check: board rows read as GitHub renders tables (L-0116 D2, D3)", { timeout: 900_000 }, () => {
  it("finds an uncited move to VERIFIED in every valid row shape", () => {
    const v = (fn: (l: string) => string) => check({}, ENTRY, boardRow("P0-02", (l) => fn(statusTo("VERIFIED")(l))));
    expect(v((l) => "  " + l)).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "|P0-02|"))).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "| `P0-02` |"))).toBe(1);
    expect(v((l) => l.replace("| P0-02 |", "| P0–02 |"))).toBe(1);
    expect(v((l) => l + " x | y |")).toBe(1);
    expect(v((l) => l.replace(/^\| /, "").replace(/ \|$/, ""))).toBe(1);
    expect(v((l) => l.replace(/\| C-001 \|$/, "| C-001 \\| x \\| y |"))).toBe(1);
  });

  it("passes a properly cited move written in another valid row shape", () => {
    const shaped = (l: string) => " " + statusTo("VERIFIED (L-NEXT)")(l).replace("| P0-02 |", "|**P0-02**|").replace(/ \|$/, "");
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

describe("log check: a verdict must be newer than the task's latest DONE (L-0116 D4)", { timeout: 900_000 }, () => {
  it("refuses a reopened task citing a verdict from before its latest DONE", () => {
    expect(check({}, ENTRY, boardRow("P0-06", statusTo("VERIFIED (L-0030)")))).toBe(1);
    expect(check({}, ENTRY, boardRow("P1-01", statusTo("VERIFIED (L-0061)")))).toBe(1);
    const doneAfter = [
      ...verdict(OTHER10, "CORRECTION"),
      `### L-NEXT1 · 2026-10-27 05:00 PKT · ${BUILDER10} · DONE`,
      "**Task:** P0-02    **Claim:** C-001",
      "**What / why:** redone after the verdict.",
      "**Evidence:** rulings case evidence.",
      "**Rules touched:** —",
      "**Next / needs:** —",
      "",
      "Security checklist (tick honestly):",
      '[x] No control weakened, skipped or "temporarily" disabled (H-16)',
      "",
    ];
    expect(check({}, doneAfter, boardRow("P0-02", statusTo("VERIFIED (L-NEXT)")))).toBe(1);
  });
});

const JWT10 = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const utf16 = (s: string, order: "le" | "be", bom: boolean) => {
  const b = Buffer.from(s, "utf16le");
  if (order === "be") b.swap16();
  const mark = order === "le" ? [0xff, 0xfe] : [0xfe, 0xff];
  return bom ? Buffer.concat([Buffer.from(mark), b]) : b;
};
// A side branch merged with --no-ff; resolve() may add files to the merge commit itself.
const mergeWith = (resolve: (g: Git, write: Write) => void, removeAfter: string[] = []) => (g: Git, write: Write) => {
  const caseBranch = g("rev-parse", "--abbrev-ref", "HEAD").trim();
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

describe("log check: history pass over merges, headers and wide encodings (L-0116 D5 to D7)", { timeout: 900_000 }, () => {
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

describe("log check: owner terms in paths of every commit (L-0116 D8)", { timeout: 900_000 }, () => {
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
