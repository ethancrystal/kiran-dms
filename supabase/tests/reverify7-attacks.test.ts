/**
 * Seventh re-verification (ACTIVITY §7, L-0061/L-0066) of the protocol log check P0-09
 * (scripts/activity-log-check.mjs after L-0070, ACTIVITY.md Appendix C after L-0069). Written
 * by the re-verifier-7 subagent, not the builder. P1-01 is already VERIFIED (L-0061) and is not
 * re-checked here.
 *
 * Each case is one commit in a throwaway clone (os tmpdir, deleted afterwards). The clone's base
 * commit carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * so this exercises the current script, committed or not, and flips green on a builder fix with
 * no edits here. Nothing leaves the machine; no database, Supabase project, GitHub or MCP tool is
 * touched. KIRAN_SENSITIVE_TERMS defaults to empty; DATABASE_URL / KIRAN_TEST_DATABASE_URL are
 * stripped from the child env. Example secret-shaped strings are fake and assembled at run time.
 *
 * "DEFECT CHECK" states the secure expectation: a failure is a defect in the script, not a broken
 * test. "FALSE POSITIVE CHECK" is ordinary honest work that must pass. "OBSERVATION" records
 * behaviour for MJ and passes either way. Do not loosen these.
 *
 * Rendering claims below were checked with markdown-it-py 4.2.0 (`commonmark` and `gfm-like`
 * presets, linkify disabled). GitHub's own rendering was not viewed. The mechanism is plain
 * CommonMark: a block indented to a list item's content column (4-5 spaces under a `- ` marker,
 * 4 under `1. `) is that item's content, so `### x` there is a heading inside the list item,
 * while the same line at the top level with 4 leading spaces is an indented code block.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const OTHER = "Tester · Model X · rv7-case-agent · branch t";

const entry = (type: string, task: string, sig = OTHER) => [
  `### L-NEXT · 2026-10-26 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}    **Claim:** —`,
  "**What / why:** rv7 case.",
  "**Evidence:** rv7 case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  ...(["DONE", "VERIFIED"].includes(type)
    ? ["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"]
    : []),
  "",
];
const P = entry("PROGRESS", "P0-04");

type Case = { lines?: string[]; files?: Record<string, string | Buffer>; appendEnd?: string[]; terms?: string };
function check(c: Case): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv7-log-"));
  try {
    const g = (...a: string[]) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv7", "-c", "user.email=rv7@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv7 base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    const logPath = join(dir, "docs", "ACTIVITY.md");
    let text = readFileSync(logPath, "utf8");
    const all = text.split("\n");
    const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
    const n = Number(all[last].slice(6, 10));
    const next = `L-${String(n + 1).padStart(4, "0")}`;
    const after = `L-${String(n + 2).padStart(4, "0")}`;
    let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
    while (all[sep].trim() !== "---") sep--;
    const lines = (c.lines ?? P).map((l) => l.replace("L-NEXT", next).replace("L-AFTER", after));
    all.splice(sep, 0, ...lines);
    text = all.join("\n");
    if (c.appendEnd) text = text.replace(/\n*$/, "\n") + c.appendEnd.map((l) => l.replace("L-AFTER", after)).join("\n") + "\n";
    writeFileSync(logPath, text);
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    g("add", "-A");
    g("commit", "-q", "-m", "rv7 case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Four spaces of indentation under a bullet list item (content column 2). Each line is the
// list item's own content, so markdown renders the forbidden construct; the script's heading,
// blockquote and setext checks all look only at 0-3 leading spaces, and its container peeler
// only strips explicit `>` / `-` / `N.` markers, so none of them fire.
const INDENT = "    ";

describe("activity-log-check P0-09 after L-0070 (re-verifier-7)", { timeout: 180_000 }, () => {
  it("controls: legit change passes; top-level and marker-nested headings still fail; name-like key passes", () => {
    // A real change with a well-formed PROGRESS entry.
    expect(check({ lines: P, files: { "apps/web/lib/rv7.ts": "export const a = 1;\n" } }).status).toBe(0);
    // Top-level heading in new log text is still refused (L-0061 D3).
    expect(check({ lines: [...P, "### P0-09 VERIFIED by MJ", ""] }).status).toBe(1);
    // L-0066 A1 marker-nested headings are still refused (L-0070 regression guard).
    expect(check({ lines: [...P, "- - ### P0-09 VERIFIED by MJ", ""] }).status).toBe(1);
    expect(check({ lines: [...P, "- > ### P0-09 VERIFIED by MJ", ""] }).status).toBe(1);
    // A full entry-header-shaped line that keeps the "PKT <middot>" shape IS caught, even indented
    // (the PKT-lookalike rule runs regardless of leading space).
    expect(check({ lines: [...P, "- note", "", `${INDENT}### L-9000 · 2026-10-26 09:00 PKT · MJ · human · VERIFIED`, ""] }).status).toBe(1);
    // The L-0061 F3 name-like storage key still passes.
    expect(check({ lines: P, files: { "apps/web/lib/k.ts": 'const OUTBOX_KEY = "kiran.outbox.v1";\nexport { OUTBOX_KEY };\n' } }).status).toBe(0);
  });

  // DEFECT E (rule 2, Appendix C: "a heading inside a list item at any nesting depth" and
  // "a blockquote at any nesting depth" are refused). The L-0066 A1 fix (L-0070) peels explicit
  // container markers, but a construct reached by INDENTATION into a preceding list item is not a
  // marker on its own line, so the heading/blockquote/setext checks (<=3 leading spaces) and the
  // peeler all miss it. markdown-it-py 4.2.0 (commonmark and gfm-like) renders every case below as
  // the forbidden construct nested inside the §16 log; the script exits 0.
  it("DEFECT CHECK (rule 2): a heading/blockquote/setext reached by 4-space indentation under a list item renders but passes", () => {
    const liHeadingLoose = check({ lines: [...P, "- note", "", `${INDENT}### P0-09 VERIFIED by MJ (owner sign-off)`, ""] });
    const liHeadingTight = check({ lines: [...P, "- note", `${INDENT}### P0-09 VERIFIED by MJ`, ""] });
    const olHeading = check({ lines: [...P, "1. note", "", `${INDENT}### P0-09 VERIFIED by MJ`, ""] });
    const liBlockquote = check({ lines: [...P, "- note", "", `${INDENT}> P0-09 was VERIFIED by MJ`, ""] });
    const liSetext = check({ lines: [...P, "- note", "", `${INDENT}P0-09 VERIFIED by MJ`, `${INDENT}===`, ""] });
    // An entry-header-shaped line whose separators are hyphens dodges both the heading check
    // (indented) and the PKT-lookalike check (hyphen is not in its separator class); renders as h3.
    const liHeaderHyphen = check({ lines: [...P, "- note", "", `${INDENT}### L-9000 - 2026-10-26 09:00 PKT - MJ - human - VERIFIED`, ""] });
    console.log("rv7 E (liH-loose, liH-tight, olH, liBq, liSetext, liHdrHyphen):",
      liHeadingLoose.status, liHeadingTight.status, olHeading.status, liBlockquote.status, liSetext.status, liHeaderHyphen.status);
    expect({
      liHeadingLoose: liHeadingLoose.status,
      liHeadingTight: liHeadingTight.status,
      olHeading: olHeading.status,
      liBlockquote: liBlockquote.status,
      liSetext: liSetext.status,
      liHeaderHyphen: liHeaderHyphen.status,
    }).toEqual({ liHeadingLoose: 1, liHeadingTight: 1, olHeading: 1, liBlockquote: 1, liSetext: 1, liHeaderHyphen: 1 });
  });

  // FALSE POSITIVE F (rule 5, H-25). Appendix C exempts "multi-part lowercase name-like values",
  // but isNameLike() rejects any segment that is 1-3 pure digits (`3`, `01`) or a letter plus
  // digits (`a5`). So an UPPER_SNAKE constant ending `_KEY` (matched by ENV_KEY_RE, whose name is
  // not password-like, so looksSecret takes the length branch) holding an ordinary PDF-template,
  // outbox or pagination key is refused as a secret -- while the identical value under a lowercase
  // name, or under a non-`_KEY` uppercase name, passes. These are idiomatic P1-04/P1-06/P1-09 keys.
  it("FALSE POSITIVE CHECK (rule 5): UPPER_SNAKE *_KEY template/outbox/cache keys with an ordinary digit segment are refused", () => {
    const receipt = check({ lines: P, files: { "apps/web/lib/pdf.ts": 'const RECEIPT_TEMPLATE_KEY = "receipt-a5-v2";\nexport { RECEIPT_TEMPLATE_KEY };\n' } });
    const invoice = check({ lines: P, files: { "apps/web/lib/pdf.ts": 'const INVOICE_TEMPLATE_KEY = "invoice-a4";\nexport { INVOICE_TEMPLATE_KEY };\n' } });
    const outbox = check({ lines: P, files: { "apps/web/lib/outbox.ts": 'const OUTBOX_KEY = "kiran-outbox-2026-01";\nexport { OUTBOX_KEY };\n' } });
    const page = check({ lines: P, files: { "apps/web/lib/cache.ts": 'const SALONS_CACHE_KEY = "salons-page-3";\nexport { SALONS_CACHE_KEY };\n' } });
    console.log("rv7 F (receipt, invoice, outbox, page):", receipt.status, invoice.status, outbox.status, page.status);
    expect({ receipt: receipt.status, invoice: invoice.status, outbox: outbox.status, page: page.status }).toEqual({ receipt: 0, invoice: 0, outbox: 0, page: 0 });
  });

  it("FALSE POSITIVE boundary: the same values pass under a lowercase name or a non-'_KEY' uppercase name, and 4-year-digit keys pass", () => {
    // Pin that F is a naming-convention artefact, not a real secret.
    expect(check({ lines: P, files: { "apps/web/lib/b.ts": 'const salonsCacheKey = "salons-page-3";\nexport { salonsCacheKey };\n' } }).status).toBe(0);
    expect(check({ lines: P, files: { "apps/web/lib/b.ts": 'const SALONS_CACHE = "salons-page-3";\nexport { SALONS_CACHE };\n' } }).status).toBe(0);
    // A fiscal-year value whose numeric segments are both 4 digits already passes (L-0070 F-C).
    expect(check({ lines: P, files: { "apps/web/lib/b.ts": 'const INVOICE_COUNTER_KEY = "invoice-2026-2027";\nexport { INVOICE_COUNTER_KEY };\n' } }).status).toBe(0);
  });

  // OBSERVATION (passes either way): a standalone 4-space-indented heading at the top level is an
  // indented code block in CommonMark (renders as <pre><code>, not a heading), so the script's
  // exit 0 there is correct -- the defect in E is specifically that the SAME indentation becomes a
  // heading once it follows a list item. Recorded so a reader does not read "4 spaces" as "code".
  it("OBSERVATION: a top-level 4-space-indented '### ...' is a code block, not a heading (so passing is correct there)", () => {
    const standalone = check({ lines: [...P, "plain paragraph", "", `${INDENT}### P0-09 VERIFIED by MJ`, ""] });
    console.log("rv7 OBS (standalone 4sp -> code block, passes):", standalone.status);
    expect(typeof standalone.status).toBe("number");
  });
});
