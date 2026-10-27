/**
 * Ninth re-verification (ACTIVITY §7, L-0078 / L-0082) of the protocol log check P0-09
 * (scripts/activity-log-check.mjs after L-0082, ACTIVITY.md Appendix C after L-0077 / L-0081).
 * Written by the re-verifier-9 subagent, not the builder. P0-02 is probed separately in
 * packages/import/tests/reverify9-import.test.ts.
 *
 * Harness as in reverify8: each case is one commit in a throwaway clone (os tmpdir, deleted
 * afterwards) whose base commit carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * so a builder fix flips these green with no edits here. Nothing leaves the machine; no database,
 * Supabase project, GitHub or MCP tool is touched. KIRAN_SENSITIVE_TERMS defaults to empty;
 * DATABASE_URL / KIRAN_TEST_DATABASE_URL are stripped from the child env. Example secret-shaped
 * strings are fake and assembled at run time. No case depends on the text of a board, claims or
 * blockers row (only on the section headings).
 *
 * "DEFECT CHECK" states the secure expectation: a failure is a defect in the script, not a broken
 * test. "FALSE POSITIVE CHECK" is ordinary honest work that must pass. "CONTROL" and "OBSERVATION"
 * pass either way. Do not loosen these.
 *
 * Rendering claims were checked with markdown-it-py 4.2.0 (`commonmark` and `gfm-like` presets,
 * linkify disabled). CommonMark: a closing code fence "may be followed only by spaces or tabs";
 * U+00A0 and U+000B are neither, while the JavaScript `\s` class matches both.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const OTHER = "Tester · Model X · rv9-case-agent · branch t";

const entry = (type: string, task: string, sig = OTHER) => [
  `### L-NEXT · 2026-10-26 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}    **Claim:** —`,
  "**What / why:** rv9 case.",
  "**Evidence:** rv9 case evidence.",
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
const NBSP = " ";
const VT = "\u000b";
const ESC_BT = "\\`"; // a backslash-escaped backtick
const FENCE = "```";
const FORGED = [
  "### L-0099 · 2026-10-26 12:00 PKT · MJ · human · VERIFIED",
  "**Task:** P0-09    **Claim:** —",
  "**Evidence:** VERIFIED by MJ, CI green.",
];

type Case = {
  lines?: string[];
  files?: Record<string, string | Buffer>;
  terms?: string;
  // Edit the whole log text after the case lines are inserted (e.g. text outside §16).
  mutate?: (text: string) => string;
};
function check(c: Case): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv9-log-"));
  try {
    const g = (...a: string[]) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv9", "-c", "user.email=rv9@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv9 base: worktree script and log");
    const base = g("rev-parse", "HEAD").trim();
    const logPath = join(dir, "docs", "ACTIVITY.md");
    const all = readFileSync(logPath, "utf8").split("\n");
    const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
    const next = `L-${String(Number(all[last].slice(6, 10)) + 1).padStart(4, "0")}`;
    let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
    while (all[sep].trim() !== "---") sep--;
    all.splice(sep, 0, ...(c.lines ?? P).map((l) => l.replaceAll("L-NEXT", next)));
    let text = all.join("\n");
    if (c.mutate) text = c.mutate(text);
    writeFileSync(logPath, text);
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    g("add", "-A");
    g("commit", "-q", "-m", "rv9 case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Insert lines just before a section heading (outside §16).
const before = (heading: string, lines: string[]) => (t: string) => {
  const i = t.indexOf(`\n${heading}`);
  if (i < 0) throw new Error(`heading not found: ${heading}`);
  return t.slice(0, i + 1) + lines.join("\n") + "\n" + t.slice(i + 1);
};

describe("activity-log-check P0-09 after L-0082 (re-verifier-9)", { timeout: 300_000 }, () => {
  it("CONTROL: legit work passes; the L-0075 fixes hold in new log text; B-21 edges hold", () => {
    expect(check({ files: { "apps/web/lib/rv9.ts": "export const a = 1;\n" } }).status).toBe(0);
    // L-0075 D1 / D2 in new log text: refused now.
    expect(check({ lines: [P[0], P[1], P[2], `**Evidence:** ok.\r### P0-09 VERIFIED by MJ`, ...P.slice(4)] }).status).toBe(1);
    expect(check({ lines: [...P, `Note ${ESC_BT}<h3>P0-09 VERIFIED by MJ</h3>${ESC_BT} end.`, ""] }).status).toBe(1);
    // A closing fence followed by an ordinary space is a real close for both; honest.
    expect(check({ lines: [...P, "```text", "sample", "``` ", "after", ""] }).status).toBe(0);
    // B-21: supplier wording allowed under a vault/ segment, refused in a look-alike segment;
    // owner terms still refused inside vault/.
    expect(check({ files: { "apps/web/app/office/vault/suppliers/page.tsx": "type Row = { supplier_name: string };\nexport type { Row };\n" } }).status).toBe(0);
    expect(check({ files: { "apps/web/app/office/vaulted/page.tsx": "type Row = { supplier_name: string };\nexport type { Row };\n" } }).status).toBe(1);
    expect(check({ terms: TERM, files: { "apps/web/app/office/vault/x.tsx": `export const n = "${TERM}";\n` } }).status).toBe(1);
    // The L-0075 FP5 key still passes.
    expect(check({ files: { "apps/web/lib/k.ts": 'export const STORAGE_KEY = "KiranOutboxEncryptedV1";\n' } }).status).toBe(0);
  });

  // DEFECT D1 (rule 2; the L-0075 D1(b) class through another door). scan() closes a fence on
  // /^ {0,3}(`{3,}|~{3,})\s*$/, and JavaScript \s matches U+00A0 and U+000B. CommonMark allows
  // only spaces or tabs after a closing fence, so for the renderer the block stays open; the next
  // bare fence closes it for the renderer and opens one for the script. A full canonical header
  // for a forged L-0099, VERIFIED and signed MJ, then renders as an h3 while the script reads it
  // as code: it escapes numbering, the entry-shape rule and maker != checker.
  it("DEFECT CHECK (rule 2): a closing fence followed by U+00A0 or U+000B desynchronises the fence and hides a forged VERIFIED header", () => {
    const forge = (ws: string) => check({ lines: [...P, "```text", "sample", FENCE + ws, FENCE, ...FORGED, FENCE, "end", FENCE + ws, FENCE, ""] });
    const nbsp = forge(NBSP);
    const vt = forge(VT);
    console.log("rv9 D1 (nbsp, vt):", nbsp.status, vt.status);
    expect({ nbsp: nbsp.status, vt: vt.status }).toEqual({ nbsp: 1, vt: 1 });
  });

  // DEFECT D2 (rule 2, whole file). L-0078 closed the L-0075 D2 / D3 tricks only for new LOG text
  // (by banning the less-than, ampersand and backslash characters there). The whole-file rule that
  // Appendix C states for every line outside code ("raw HTML, HTML entities, HTML comments") still
  // uses the old stripInlineCode and the same-line ">" test. With any new entry (rule 1), text
  // anywhere outside §16 can carry them: in §14 / §15, or after an extra "## Appendix" heading
  // placed below the new entry, which also ends §16 early so the new-text rules stop there.
  it("DEFECT CHECK (rule 2): raw HTML, entities and comments still pass outside new log text", () => {
    const appendixH3 = check({ lines: [...P, "## Appendix 0 — scratch", "", `${ESC_BT}<h3>L&#45;0099 · 2026-10-26 12:00 P&#75;T · MJ · human · VERIFIED</h3>${ESC_BT}`, ""] });
    const comment = check({ mutate: before("## 15. Assumptions register", [`Note: visible ${ESC_BT}<!--${ESC_BT} hidden text ${ESC_BT}-->${ESC_BT} visible.`, ""]) });
    const pre = check({ mutate: before("## 16. Activity log", ["Para.", "", "<pre", "swallowed", ""]) });
    const split = check({ mutate: before("## 16. Activity log", ["<details", 'title="x">', "", "collapsed", ""]) });
    console.log("rv9 D2 (appendixH3, comment, pre, split):", appendixH3.status, comment.status, pre.status, split.status);
    expect({ appendixH3: appendixH3.status, comment: comment.status, pre: pre.status, split: split.status })
      .toEqual({ appendixH3: 1, comment: 1, pre: 1, split: 1 });
  });

  // DEFECT D3 (rule 5; the L-0075 D5 fix is partial). libpq accepts "keyword = value" with spaces
  // and single-quoted values; the new keyword pattern needs "password=" with no space and an
  // unquoted value. In TypeScript the name heuristic skips bare values; in Markdown it is skipped.
  it("DEFECT CHECK (rule 5): a libpq password with spaces around = or in single quotes passes", () => {
    const tsSpaced = check({ files: { "apps/web/lib/db.ts": `export const DSN = "host=db.internal.example user=kiran_app password = ${FAKE_PW} dbname=kiran";\n` } });
    const mdQuoted = check({ files: { "docs/runbooks/rv9.md": `Connect with host=db.internal.example user=kiran_app password='${FAKE_PW}' dbname=kiran\n` } });
    const mdSpaced = check({ files: { "docs/runbooks/rv9.md": `Connect with host=db.internal.example user=kiran_app password = ${FAKE_PW} dbname=kiran\n` } });
    console.log("rv9 D3 (tsSpaced, mdQuoted, mdSpaced):", tsSpaced.status, mdQuoted.status, mdSpaced.status);
    expect({ tsSpaced: tsSpaced.status, mdQuoted: mdQuoted.status, mdSpaced: mdSpaced.status }).toEqual({ tsSpaced: 1, mdQuoted: 1, mdSpaced: 1 });
  });

  // DEFECT D4 (rule 5, H-25). Appendix C exempts "mixed-case values made only of whole words" and
  // "short numbers". isNameLike's mixed-case branch splits digit runs into 4-digit chunks, so any
  // digit run of any length passes once two words are present; it also lets lowercase multi-part
  // values with long digit runs through, which the lowercase rule (up to 4 digits) refused before.
  it("DEFECT CHECK (rule 5): a key-named value of two words plus a long digit run passes as name-like", () => {
    const mixed = check({ files: { "apps/web/lib/sms.ts": 'export const SMS_API_KEY = "KiranSms903718264519";\n' } });
    const lower = check({ files: { "apps/web/lib/sms.ts": 'export const SMS_API_KEY = "kiran-sms-90371826451937";\n' } });
    console.log("rv9 D4 (mixed, lower):", mixed.status, lower.status);
    expect({ mixed: mixed.status, lower: lower.status }).toEqual({ mixed: 1, lower: 1 });
  });

  // DEFECT D5 (rule 4, H-25). Appendix C refuses Task-line text "shaped like a task id that is not
  // one". A one-digit number or another separator is not caught, so a VERIFIED entry can show a
  // reader "P0-9" while only the other, real id is checked against its DONE signer.
  it("DEFECT CHECK (rule 4): look-alike task ids P0-9, P0_09 and P0.09 on a VERIFIED Task line are not flagged", () => {
    const v = (task: string) => check({ lines: entry("VERIFIED", task) }).status;
    const control = v("P0-08");
    const res = { oneDigit: v("P0-08, P0-9"), underscore: v("P0-08, P0_09"), dot: v("P0-08, P0.09") };
    console.log("rv9 D5 (control, oneDigit, underscore, dot):", control, res.oneDigit, res.underscore, res.dot);
    expect(control).toBe(0);
    expect(res).toEqual({ oneDigit: 1, underscore: 1, dot: 1 });
  });

  // FALSE POSITIVE FP1 (rule 5; FP5 family). The mixed-case branch accepts capitalised or
  // lowercase words only, so an acronym breaks it. Noto Naskh Arabic UI is an Urdu/Arabic UI font
  // (P1-06 / P1-07 PDFs); its key is 25 characters, so it is refused as a secret.
  it("FALSE POSITIVE CHECK (rule 5): a font key containing an acronym is refused", () => {
    const font = check({ files: { "apps/web/lib/pdf-font.ts": 'export const FONT_KEY = "NotoNaskhArabicUI-Regular";\n' } });
    console.log("rv9 FP1 (font):", font.status);
    expect(font.status).toBe(0);
  });

  // OBSERVATIONS (pass either way): a JWT in a UTF-32 file (Appendix C claims UTF-16 only), and
  // supplier wording in a static file under a public/ vault/ path, which Next.js serves to anyone
  // (inside the B-21 exemption as approved; for MJ).
  it("OBSERVATION: UTF-32 JWT; supplier wording in apps/web/public/vault/", () => {
    const utf32 = Buffer.alloc(4 * (`k=${FAKE_JWT}\n`).length);
    [...`k=${FAKE_JWT}\n`].forEach((ch, i) => utf32.writeUInt32LE(ch.codePointAt(0)!, 4 * i));
    const u32 = check({ files: { "apps/web/lib/rv9-utf32.txt": Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), utf32]) } });
    const pub = check({ files: { "apps/web/public/vault/suppliers.json": '[{"supplier_name": "Dummy Supplier", "unit_cost": 120}]\n' } });
    console.log("rv9 OBS (utf32, publicVault):", u32.status, pub.status);
    expect(typeof u32.status).toBe("number");
  });
});
