/**
 * Eighth re-verification (ACTIVITY §7, L-0074) of the protocol log check P0-09
 * (scripts/activity-log-check.mjs after L-0074, ACTIVITY.md Appendix C after L-0073). Written by
 * the re-verifier-8 subagent, not the builder. P1-01 is already VERIFIED (L-0061) and is not
 * re-checked here.
 *
 * Each case is one commit in a throwaway clone (os tmpdir, deleted afterwards). The clone's base
 * commit carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * so this exercises the current script, committed or not, and flips green on a builder fix with
 * no edits here. Nothing leaves the machine; no database, Supabase project, GitHub or MCP tool is
 * touched. KIRAN_SENSITIVE_TERMS defaults to empty; DATABASE_URL / KIRAN_TEST_DATABASE_URL are
 * stripped from the child env. Example secret-shaped strings are fake and assembled at run time.
 * No case depends on the text of a board, claims or blockers row.
 *
 * "DEFECT CHECK" states the secure expectation: a failure is a defect in the script, not a broken
 * test. "FALSE POSITIVE CHECK" is ordinary honest work that must pass. "OBSERVATION" records
 * behaviour for MJ and passes either way. Do not loosen these.
 *
 * Rendering claims were checked with markdown-it-py 4.2.0 (`commonmark` and `gfm-like` presets,
 * linkify disabled). GitHub's own rendering was not viewed. CommonMark treats a lone carriage
 * return as a line ending; a code span needs an unescaped opening backtick run and a closing run
 * of exactly the same length; an HTML block of type 1/5/6 opens on `<pre`, `<![CDATA[` or
 * `<details` with nothing else on the line.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const OTHER = "Tester · Model X · rv8-case-agent · branch t";

const entry = (type: string, task: string, sig = OTHER) => [
  `### L-NEXT · 2026-10-26 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}    **Claim:** —`,
  "**What / why:** rv8 case.",
  "**Evidence:** rv8 case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  ...(["DONE", "VERIFIED"].includes(type)
    ? ["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"]
    : []),
  "",
];
const P = entry("PROGRESS", "P0-04");
// Fake values, assembled at run time.
const FAKE_PW = "Zq8vR2" + "mT9xLw4Kp";
const FAKE_JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJ4eHh4eHh4eCJ9", "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const TERM = "Zentrova"; // invented owner term
const CR = "\r";
const ESC_BT = "\\`"; // a backslash-escaped backtick
const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

type Case = {
  lines?: string[];
  files?: Record<string, string | Buffer>;
  terms?: string;
  msg?: string;
  plumb?: (dir: string) => void;
};
function check(c: Case): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv8-log-"));
  try {
    const g = (...a: string[]) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv8", "-c", "user.email=rv8@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv8 base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    const logPath = join(dir, "docs", "ACTIVITY.md");
    const all = readFileSync(logPath, "utf8").split("\n");
    const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
    const next = `L-${String(Number(all[last].slice(6, 10)) + 1).padStart(4, "0")}`;
    let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
    while (all[sep].trim() !== "---") sep--;
    all.splice(sep, 0, ...(c.lines ?? P).map((l) => l.replaceAll("L-NEXT", next)));
    writeFileSync(logPath, all.join("\n"));
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    g("add", "-A");
    c.plumb?.(dir);
    g("commit", "-q", "-m", c.msg ?? "rv8 case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Stage a blob under a path containing a byte that is not valid UTF-8, through the index only, so
// the odd name is never written to the (NTFS) worktree.
const stageOddPath = (content: Buffer) => (dir: string) => {
  const h = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: content });
  if (h.status !== 0) throw new Error(String(h.stderr));
  const sha = h.stdout.toString().trim();
  const path = Buffer.concat([Buffer.from("apps/web/lib/rv8-"), Buffer.from([0xff]), Buffer.from(".txt")]);
  const r = spawnSync("git", ["update-index", "--index-info"], { cwd: dir, input: Buffer.concat([Buffer.from(`100644 ${sha}\t`), path, Buffer.from("\n")]) });
  if (r.status !== 0) throw new Error(String(r.stderr));
};

describe("activity-log-check P0-09 after L-0074 (re-verifier-8)", { timeout: 300_000 }, () => {
  it("controls: legit work passes; the L-0071 cases, a plain inline tag, a JWT and a UTF-16 JWT are refused", () => {
    expect(check({ files: { "apps/web/lib/rv8.ts": "export const a = 1;\n" } }).status).toBe(0);
    expect(check({ lines: [...P, "### P0-09 VERIFIED by MJ", ""] }).status).toBe(1);
    expect(check({ lines: [...P, "- note", "", "    ### P0-09 VERIFIED by MJ", ""] }).status).toBe(1);
    expect(check({ lines: [...P, "Note <h3>P0-09 VERIFIED by MJ</h3> end.", ""] }).status).toBe(1);
    expect(check({ files: { "apps/web/lib/rv8.ts": `export const k = "${FAKE_JWT}";\n` } }).status).toBe(1);
    expect(check({ files: { "apps/web/lib/rv8-utf16.txt": utf16(`k=${FAKE_JWT}\n`) } }).status).toBe(1);
    // The same query-parameter connection string in YAML is caught by the name heuristic.
    expect(check({ files: { ".github/workflows/rv8.yml": `env:\n  DB_URL: "postgres://db.internal.example:5432/kiran?user=kiran_app&password=${FAKE_PW}"\n` } }).status).toBe(1);
    expect(check({ files: { "apps/web/lib/k.ts": 'const SALONS_CACHE_KEY = "salons-page-3";\nexport { SALONS_CACHE_KEY };\n' } }).status).toBe(0);
  });

  // DEFECT D1 (rule 2). The script splits lines on LF / CRLF only; CommonMark also ends a line at a
  // lone CR. A forged heading after a lone CR is invisible to every rule-2 test, and a lone CR
  // before a closing fence leaves the script inside a code block that the renderer has closed, so
  // a full canonical entry header (VERIFIED, signed MJ) renders as an h3 but is skipped as code.
  it("DEFECT CHECK (rule 2): a lone carriage return hides a rendered heading and a forged canonical VERIFIED header", () => {
    const crHeading = check({ lines: [P[0], P[1], P[2], `**Evidence:** ok.${CR}### P0-09 VERIFIED by MJ (owner sign-off)`, ...P.slice(4)] });
    const crFence = check({ lines: [...P, "```text", `sample${CR}\`\`\``, "### L-0099 · 2026-10-26 12:00 PKT · MJ · human · VERIFIED", "**Task:** P0-09    **Claim:** —", "**Evidence:** VERIFIED by MJ, CI green.", "```", `end${CR}\`\`\``, ""] });
    console.log("rv8 D1 (crHeading, crFence):", crHeading.status, crFence.status);
    expect({ crHeading: crHeading.status, crFence: crFence.status }).toEqual({ crHeading: 1, crFence: 1 });
  });

  // DEFECT D2 (rule 2). stripInlineCode removes `...` before the raw-HTML, entity and comment tests,
  // but ignores backslash-escaped backticks and accepts a closing run that is part of a longer run.
  // CommonMark then renders the "code" as live HTML: an h3, a canonical-looking header spelled with
  // entities, or a comment that hides text.
  it("DEFECT CHECK (rule 2): raw HTML, entities and comments pass inside text the script wrongly treats as a code span", () => {
    const escH3 = check({ lines: [...P, `Note ${ESC_BT}<h3>P0-09 VERIFIED by MJ</h3>${ESC_BT} end.`, ""] });
    const runH3 = check({ lines: [...P, "Note `<h3>P0-09 VERIFIED by MJ</h3>`` end.", ""] });
    const entityHeader = check({ lines: [...P, `${ESC_BT}<h3>L&#45;0099 · 2026-10-26 12:00 P&#75;T · MJ · human · VERIFIED</h3>${ESC_BT}`, ""] });
    const comment = check({ lines: [...P, `Visible ${ESC_BT}<!--${ESC_BT} tests FAILED 3 ${ESC_BT}-->${ESC_BT} visible.`, ""] });
    console.log("rv8 D2 (escH3, runH3, entityHeader, comment):", escH3.status, runH3.status, entityHeader.status, comment.status);
    expect({ escH3: escH3.status, runH3: runH3.status, entityHeader: entityHeader.status, comment: comment.status })
      .toEqual({ escH3: 1, runH3: 1, entityHeader: 1, comment: 1 });
  });

  // DEFECT D3 (rule 2). The raw-HTML test needs the closing ">" on the same line. An open tag split
  // over two lines, or an HTML block start with nothing after it, passes and renders as raw HTML.
  it("DEFECT CHECK (rule 2): raw HTML whose tag does not close on the same line passes", () => {
    const split = check({ lines: [...P, "Para.", "<details", 'title="x">', "", "collapsed text", ""] });
    const pre = check({ lines: [...P, "Para.", "", "<pre", "swallowed text", ""] });
    const cdata = check({ lines: [...P, "Para.", "", "<![CDATA[", "swallowed text", ""] });
    console.log("rv8 D3 (split, pre, cdata):", split.status, pre.status, cdata.status);
    expect({ split: split.status, pre: pre.status, cdata: cdata.status }).toEqual({ split: 1, pre: 1, cdata: 1 });
  });

  // DEFECT D4 (rules 0 and 5; fail-open). File names are read as UTF-8 text, so a name with a
  // non-UTF-8 byte is mangled; `git show HEAD:<mangled>` then fails, readAdded() swallows it and
  // the full UTF-16 scan is skipped without an error. A UTF-16 JWT or owner term passes.
  it("DEFECT CHECK (rules 0, 5): an unreadable path silently skips the UTF-16 scan", () => {
    const jwt = check({ plumb: stageOddPath(utf16(`k=${FAKE_JWT}\n`)) });
    const term = check({ terms: TERM, plumb: stageOddPath(utf16(`label ${TERM}\n`)) });
    console.log("rv8 D4 (jwt, term):", jwt.status, term.status);
    expect({ jwt: jwt.status, term: term.status }).toEqual({ jwt: 1, term: 1 });
  });

  // DEFECT D5 (rule 5, H-25). Appendix C promises to catch "connection strings with a password";
  // only the user:password@ form is matched. A password as a URI query parameter or in a libpq
  // keyword string passes in source code (bare values inside a literal are skipped there) and in
  // Markdown (the name heuristic is skipped there).
  it("DEFECT CHECK (rule 5): connection strings carrying a password outside the userinfo part pass", () => {
    const uriQuery = check({ files: { "apps/web/lib/db.ts": `export const DB_URL = "postgres://db.internal.example:5432/kiran?user=kiran_app&password=${FAKE_PW}";\n` } });
    const keyword = check({ files: { "apps/web/lib/db.ts": `export const DSN = "host=db.internal.example user=kiran_app password=${FAKE_PW} dbname=kiran";\n` } });
    const runbook = check({ files: { "docs/runbooks/rv8.md": `Connect with postgres://db.internal.example:5432/kiran?user=kiran_app&password=${FAKE_PW}\n` } });
    console.log("rv8 D5 (uriQuery, keyword, runbook):", uriQuery.status, keyword.status, runbook.status);
    expect({ uriQuery: uriQuery.status, keyword: keyword.status, runbook: runbook.status }).toEqual({ uriQuery: 1, keyword: 1, runbook: 1 });
  });

  // FALSE POSITIVE FP1 (rule 2; documented in Appendix C since L-0073). The entry-id-plus-timezone
  // rule tests the raw line, so it refuses ordinary prose of the kind L-0016 (builder) and L-0066
  // (re-verifier-6) already contain, even when the timezone word is inside inline code.
  it("FALSE POSITIVE CHECK (rule 2): honest prose naming an entry id and the timezone is refused", () => {
    const clock = check({ lines: [P[0], P[1], "**What / why:** Corrects L-0074: this machine's clock reports PST although entries are labelled PKT.", ...P.slice(3)] });
    const codeSpan = check({ lines: [P[0], P[1], P[2], "- A1: a near-header using `|` instead of the middot also dodges the `PKT` separator check (L-0070).", ...P.slice(3)] });
    console.log("rv8 FP1 (clock, codeSpan):", clock.status, codeSpan.status);
    expect({ clock: clock.status, codeSpan: codeSpan.status }).toEqual({ clock: 0, codeSpan: 0 });
  });

  // FALSE POSITIVE FP2 (rule 2, H-25). L-0070 added "|" to the separator class after the timezone
  // word; Appendix C still describes only the middot form. Any table cell ending in a time, in a log
  // entry or in the §12-§15 tables, is refused as a non-canonical entry header.
  it("FALSE POSITIVE CHECK (rule 2): a table cell holding a time with the timezone word is refused", () => {
    const table = check({ lines: [...P, "| Run | Time | Result |", "|---|---|---|", "| db:test | 10:05 PKT | 437 passed |", ""] });
    console.log("rv8 FP2 (table):", table.status);
    expect(table.status).toBe(0);
  });

  // FALSE POSITIVE FP3 (rule 5; spec gap, not H-25). Supplier wording is allowed only in vault
  // migrations, tests and docs, so the owner's vault UI that doc 07 plans for P1-05 (a row field
  // read from vault_api, an i18n label) cannot pass without renaming every identifier.
  it("FALSE POSITIVE CHECK (rule 5): P1-05 vault UI and i18n code naming the supplier is refused", () => {
    const ui = check({ files: { "apps/web/app/office/vault/suppliers/page.tsx": "type Row = { id: string; supplier_name: string };\nexport function SupplierCell({ row }: { row: Row }) {\n  return <td>{row.supplier_name}</td>;\n}\n" } });
    const label = check({ files: { "packages/shared/i18n/en.ts": "export const en = {\n  supplier: \"Supplier\",\n  save: \"Save\",\n};\n" } });
    console.log("rv8 FP3 (ui, label):", ui.status, label.status);
    expect({ ui: ui.status, label: label.status }).toEqual({ ui: 0, label: 0 });
  });

  // FALSE POSITIVE FP4 (rule 2, minor H-25). CommonMark autolinks are not raw HTML, but the tag
  // regex refuses a URL or an e-mail address in angle brackets.
  it("FALSE POSITIVE CHECK (rule 2): an autolink URL or e-mail in a log entry is refused as raw HTML", () => {
    const url = check({ lines: [P[0], P[1], P[2], "**Evidence:** CI run at <https://ci.example.test/runs/42> was green.", ...P.slice(4)] });
    const mail = check({ lines: [...P, "Commit trailer: Co-Authored-By: Claude <noreply@anthropic.com>", ""] });
    console.log("rv8 FP4 (url, mail):", url.status, mail.status);
    expect({ url: url.status, mail: mail.status }).toEqual({ url: 0, mail: 0 });
  });

  // FALSE POSITIVE FP5 (rule 5; same family as L-0071 F). isNameLike is lowercase-only, so a
  // mixed-case font or storage key under an UPPER_SNAKE *_KEY name is refused as a secret.
  it("FALSE POSITIVE CHECK (rule 5): a mixed-case font key for Urdu PDFs is refused", () => {
    const font = check({ files: { "apps/web/lib/pdf-font.ts": 'export const FONT_KEY = "NotoNastaliqUrdu-Regular";\n' } });
    console.log("rv8 FP5 (font):", font.status);
    expect(font.status).toBe(0);
  });

  // OBSERVATIONS (pass either way): a Cyrillic look-alike in an owner term (inherent, L-0061 D5),
  // an owner term only in a commit message (Appendix C does not claim commit messages; H-01 lists
  // them), and a device `manufacturer` field (doc 07 reserves that word).
  it("OBSERVATION: homoglyph owner term, owner term in a commit message, device manufacturer field", () => {
    const homoglyph = check({ terms: TERM, files: { "apps/web/lib/rv8.ts": "// Zеntrova\n" } });
    const commitMsg = check({ terms: TERM, msg: `rv8: switch to ${TERM}`, files: { "apps/web/lib/rv8.ts": "export const b = 2;\n" } });
    const device = check({ files: { "apps/web/lib/device-info.ts": "export const label = (d: { manufacturer?: string }) => d.manufacturer ?? \"\";\n" } });
    console.log("rv8 OBS (homoglyph, commitMsg, device):", homoglyph.status, commitMsg.status, device.status);
    expect(typeof homoglyph.status).toBe("number");
  });
});
