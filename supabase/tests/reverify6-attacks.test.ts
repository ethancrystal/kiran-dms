/**
 * Sixth re-verification (ACTIVITY §7, L-0061/L-0064) of the protocol log check P0-09
 * (scripts/activity-log-check.mjs after L-0064, Appendix C after L-0063). Written by the
 * re-verifier-6 subagent, not the builder. P1-01 is already VERIFIED (L-0061) and is not
 * re-checked here.
 *
 * Each case is one commit in a throwaway clone (os tmpdir, deleted afterwards). The clone's
 * base commit carries the WORKTREE script and log, checked with
 *   node scripts/activity-log-check.mjs <base> HEAD
 * so this exercises the current script, committed or not. Nothing leaves the machine; no
 * database, Supabase project, GitHub or MCP tool is touched. KIRAN_SENSITIVE_TERMS defaults
 * to empty; DATABASE_URL / KIRAN_TEST_DATABASE_URL are stripped from the child env.
 *
 * "DEFECT CHECK" states the secure expectation: a failure is a defect in the script, not a
 * broken test. "FALSE POSITIVE CHECK" is ordinary honest work that must pass. "OBSERVATION"
 * records behaviour for MJ and passes either way. Do not loosen these.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const OTHER = "Tester · Model X · rv6-case-agent · branch t";
const MID = "·";

const entry = (type: string, task: string, sig = OTHER) => [
  `### L-NEXT · 2026-10-26 04:00 PKT · ${sig} · ${type}`,
  `**Task:** ${task}    **Claim:** —`,
  "**What / why:** rv6 case.",
  "**Evidence:** rv6 case evidence.",
  "**Rules touched:** —",
  "**Next / needs:** —",
  ...(["DONE", "VERIFIED"].includes(type)
    ? ["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"]
    : []),
  "",
];
const P = entry("PROGRESS", "P0-04");

type Case = { lines?: string[]; files?: Record<string, string | Buffer>; appendEnd?: string[]; edit?: [string, string]; terms?: string };
function check(c: Case): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv6-log-"));
  try {
    const g = (...a: string[]) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv6", "-c", "user.email=rv6@example.test", ...a], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
    if (cl.status !== 0) throw new Error(cl.stderr);
    for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", "rv6 base: worktree script and log");
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
    if (c.edit) {
      if (!text.includes(c.edit[0])) throw new Error(`edit anchor missing: ${c.edit[0]}`);
      text = text.replace(c.edit[0], c.edit[1]);
    }
    writeFileSync(logPath, text);
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    g("add", "-A");
    g("commit", "-q", "-m", "rv6 case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
    delete env.DATABASE_URL;
    delete env.KIRAN_TEST_DATABASE_URL;
    const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const FORGED = (n: string) => `### ${n} · 2026-10-26 04:05 PKT · MJ · human · owner sign-off · VERIFIED`;

describe("activity-log-check P0-09 after L-0064 (re-verifier-6)", { timeout: 180_000 }, () => {
  it("controls: a legitimate change with an entry passes; L-0061 D1/D4/D7 replays still fail", () => {
    expect(check({ lines: P, files: { "apps/web/lib/rv6.ts": "export const a = 1;\n" } }).status).toBe(0);
    // D1 (indented closing fence) replay
    expect(check({ lines: [...P, "```text", "rv6 out", "  ```", FORGED("L-AFTER"), "**Task:** P0-09    **Claim:** —", "**Evidence:** VERIFIED by MJ.", "<div", "```", ">", ""] }).status).toBe(1);
    // D4 (look-alike task id) replay
    expect(check({ lines: entry("VERIFIED", "P0-O4, P0-06") }).status).toBe(1);
    // D7 (deleted blank line in an old entry) replay
    expect(check({ lines: P, edit: ["**Next / needs:** Re-verification (§7).\n\nSecurity checklist", "**Next / needs:** Re-verification (§7).\nSecurity checklist"] }).status).toBe(1);
  });

  // DEFECT A (rule 2, Appendix C line "no ... blockquote, or a heading inside a list item").
  // L-0061 D3 / L-0064 refuse a top-level `> ###` and `- ###`, but a heading nested one container
  // deeper (list>blockquote, list>list, ordered-list>blockquote) is neither refused nor caught,
  // and CommonMark (markdown-it-py 4.2.0, verified) renders each as a real <h3> inside the §16 log.
  it("DEFECT CHECK (rule 2): a heading nested in list>blockquote or list>list in new log text renders as <h3> but passes", () => {
    const liBq = check({ lines: [...P, `- > ### L-AFTER | 2026-10-26 04:05 PKT | MJ | VERIFIED`, ""] });
    const liLi = check({ lines: [...P, "- - ### P0-09 VERIFIED by MJ (owner sign-off)", ""] });
    const olBq = check({ lines: [...P, "1. > ### P0-09 VERIFIED by MJ", ""] });
    console.log("rv6 A (list>bq, list>list, ol>bq):", liBq.status, liLi.status, olBq.status);
    expect({ liBq: liBq.status, liLi: liLi.status, olBq: olBq.status }).toEqual({ liBq: 1, liLi: 1, olBq: 1 });
  });

  // FALSE POSITIVE B (rule 5, headline). The L-0061 F3 "name-like storage key" exemption disappears
  // whenever the KEY NAME itself contains token/pass/pwd/secret: looksSecret() takes the password
  // branch (length only) and never consults isNameLike(). A storage-slot name like `kiran.auth.token.v1`
  // (the exact F3-allowed form) is refused under `TOKEN_KEY`/`AUTH_TOKEN`/`SESSION_TOKEN_KEY`, though
  // the identical value under a benign name passes. Appendix C names no such name-based carve-out.
  it("FALSE POSITIVE CHECK (rule 5): a storage-key name containing 'token' with a name-like value is refused, though the same value under a benign name passes", () => {
    const control = check({ lines: P, files: { "apps/web/lib/k.ts": 'const AUTH_STATE_KEY = "kiran.auth.token.v1";\nexport { AUTH_STATE_KEY };\n' } });
    const tokenKey = check({ lines: P, files: { "apps/web/lib/k.ts": 'const TOKEN_KEY = "kiran.auth.token.v1";\nexport { TOKEN_KEY };\n' } });
    const sessKey = check({ lines: P, files: { "apps/web/lib/k.ts": 'const SESSION_TOKEN_KEY = "kiran.session.v1";\nexport { SESSION_TOKEN_KEY };\n' } });
    console.log("rv6 B (control, TOKEN_KEY, SESSION_TOKEN_KEY):", control.status, "|", tokenKey.status, tokenKey.out.split("\n")[1]?.trim(), "|", sessKey.status, sessKey.out.split("\n")[1]?.trim());
    expect({ control: control.status, tokenKey: tokenKey.status, sessKey: sessKey.status }).toEqual({ control: 0, tokenKey: 0, sessKey: 0 });
  });

  // FALSE POSITIVE C (rule 5). isNameLike() accepts only `. _ / -` separators and at most two
  // trailing digits per segment, so two ordinary storage-key conventions are refused: the Redis
  // `a:b:c` form (P1-09 cache), and a segment with a 3-4 digit or fiscal-year number
  // (H-11 numbers per financial year), e.g. `kiran.invoice.fy2026` / `kiran.invoice.2026`.
  it("FALSE POSITIVE CHECK (rule 5): colon-delimited and fiscal-year storage keys are refused like secrets", () => {
    const colon = check({ lines: P, files: { "apps/web/lib/c.ts": 'const OUTBOX_KEY = "kiran:outbox:v1";\nexport { OUTBOX_KEY };\n' } });
    const fy = check({ lines: P, files: { "apps/web/lib/c.ts": 'const DOC_COUNTER_KEY = "kiran.invoice.fy2026";\nexport { DOC_COUNTER_KEY };\n' } });
    const year = check({ lines: P, files: { "apps/web/lib/c.ts": 'const DOC_COUNTER_KEY = "kiran.invoice.2026";\nexport { DOC_COUNTER_KEY };\n' } });
    console.log("rv6 C (colon, fy2026, 2026):", colon.status, fy.status, year.status);
    expect({ colon: colon.status, fy: fy.status, year: year.status }).toEqual({ colon: 0, fy: 0, year: 0 });
  });

  // FALSE POSITIVE D (rule 5, secondary). A constant whose name contains "token" holding a
  // non-secret string -- a CSS value or UI design token, a spacing scale -- is refused purely
  // because the name matches "token" and the value is >= 12 chars, with no value-shape check.
  it("FALSE POSITIVE CHECK (rule 5): a 'token'-named constant holding a CSS/design value is refused", () => {
    const color = check({ lines: P, files: { "apps/web/lib/d.ts": 'const colorToken = "oklch(0.7 0.1 240)";\nexport { colorToken };\n' } });
    const spacing = check({ lines: P, files: { "apps/web/lib/d.ts": 'const spacingToken = "0.25rem 0.5rem 1rem";\nexport { spacingToken };\n' } });
    console.log("rv6 D (colorToken, spacingToken):", color.status, spacing.status);
    expect({ color: color.status, spacing: spacing.status }).toEqual({ color: 0, spacing: 0 });
  });

  // OBSERVATIONS (pass either way) — behaviour recorded for MJ, not defects.
  it("OBSERVATION: a non-canonical h3 outside the log, a no-BOM UTF-16 name-heuristic gap, and accepted inherents", () => {
    // O1: a non-canonical heading (no 'PKT <middot>') appended to an appendix passes. Appendix C
    //     rule 2 promises to catch only *canonical* headers outside the log; this is the L-0061 O5
    //     class (edits outside the log are caught by review, not the tripwire). Renders as an <h3>.
    const apxHeading = check({ lines: P, appendEnd: ["", "### P0-09 VERIFIED by MJ — owner sign-off 2026-10-26", ""] });
    // O2: the UTF-16 name-heuristic is gated by a 4 KB NUL sample (the narrowed L-0061 D6). A no-BOM
    //     UTF-16LE file whose first 4 KB is non-ASCII (so ~no NUL) escapes the name heuristic; a plain
    //     password line later in the file is not flagged. The hard JWT/key patterns still run in full.
    const JWT = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "ZmFrZS1zaWduYXR1cmUtcnY2"].join(".");
    const pw = ["Hunter", "2", "Hunter", "2", "Hunter", "2"].join("");
    const utf16NameGap = check({ lines: P, files: { "apps/web/status.txt": Buffer.from("آ".repeat(2100) + `\npassword = ${pw}\n`, "utf16le") } });
    // The same file carrying a JWT-shaped value IS caught in full (control for O2).
    const utf16Jwt = check({ lines: P, files: { "apps/web/status.txt": Buffer.from("آ".repeat(2100) + `\nKEY=${JWT}\n`, "utf16le") } });
    console.log("rv6 OBS (apxHeading, utf16NameGap, utf16Jwt):", apxHeading.status, utf16NameGap.status, utf16Jwt.status);
    expect(typeof apxHeading.status).toBe("number");
    expect(utf16Jwt.status).toBe(1);
  });
});
