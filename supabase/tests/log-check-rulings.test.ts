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

function check(files: Record<string, string | Buffer>, entry: string[] = ENTRY, mutate?: (t: string) => string): number | null {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rulings-"));
  try {
    const g = (...a: string[]) => {
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
    all.splice(sep, 0, ...entry.map((l) => l.replaceAll("L-NEXT", next)));
    let text = all.join("\n");
    if (mutate) text = mutate(text).replaceAll("L-NEXT", next);
    writeFileSync(logPath, text);
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    g("add", "-A");
    g("commit", "-q", "-m", "case");
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: "" };
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
