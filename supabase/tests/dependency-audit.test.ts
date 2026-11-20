/**
 * Builder tests for scripts/dependency-audit.mjs (doc 06 section 10.8, H-18).
 * Captures a real `pnpm audit --json --prod` sample as the fixture and drives the
 * evaluateAudit helper through it, plus hand-built cases for expiry, reason and severity.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AuditException, evaluateAudit } from "../../scripts/dependency-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "..", "scripts", "dependency-audit.mjs");
const FIXTURE = join(here, "..", "..", "scripts", "fixtures", "audit-sample.json");

function runScript(args: string[] = [], env: Record<string, string> = {}, input = ""): number | null {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }).status;
}

type Advisory = { severity?: string; findings?: unknown[]; references?: unknown };
type AuditReport = { advisories: Record<string, Advisory> };

function fixture(): AuditReport {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as AuditReport;
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const HIGH: Advisory = { severity: "high", findings: [], references: [] };
const CRITICAL: Advisory = { severity: "critical", findings: [], references: [] };
const withAdvisory = (report: AuditReport, id: string, advisory: Advisory): AuditReport => {
  report.advisories[id] = advisory;
  return report;
};

describe("dependency-audit (doc 06 10.8)", () => {
  it("runs the CLI over the real sample with no exceptions and exits zero (moderate only)", () => {
    expect(runScript(["--exceptions", FIXTURE], {}, readFileSync(FIXTURE, "utf8"))).toBe(0);
  });

  it("CLI over a report with a high advisory and no exception exits non-zero", () => {
    expect(runScript([], {}, JSON.stringify(withAdvisory(fixture(), "888888", HIGH)))).toBe(1);
  });

  it("accepts the --exceptions=<path> form too", () => {
    expect(runScript([`--exceptions=${FIXTURE}`], {}, readFileSync(FIXTURE, "utf8"))).toBe(0);
  });

  it("high advisory with no exception makes ok false and names the advisory id", () => {
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "888888", HIGH), [], today());
    expect(ok).toBe(false);
    expect(failures.some((f) => f.includes("888888"))).toBe(true);
  });

  it("critical advisory with no exception makes ok false and names the advisory id", () => {
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "999999", CRITICAL), [], today());
    expect(ok).toBe(false);
    expect(failures.some((f) => f.includes("999999") && f.includes("critical"))).toBe(true);
  });

  it("high advisory with a valid exception makes ok true", () => {
    const exceptions: AuditException[] = [{ id: "888888", reason: "accepted while the fix lands", expires: inDays(60) }];
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "888888", HIGH), exceptions, today());
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it("exception whose expires is before today fails and says expired", () => {
    const exceptions: AuditException[] = [{ id: "888888", reason: "temp", expires: "2000-01-01" }];
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "888888", HIGH), exceptions, today());
    expect(ok).toBe(false);
    expect(failures.some((f) => f.includes("expired"))).toBe(true);
  });

  it("exception with empty reason fails", () => {
    const exceptions: AuditException[] = [{ id: "888888", reason: "   ", expires: inDays(30) }];
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "888888", HIGH), exceptions, today());
    expect(ok).toBe(false);
    expect(failures.some((f) => f.includes("empty reason"))).toBe(true);
  });

  it("exception with expires more than 90 days after today fails", () => {
    const exceptions: AuditException[] = [{ id: "888888", reason: "long", expires: inDays(120) }];
    const { ok, failures } = evaluateAudit(withAdvisory(fixture(), "888888", HIGH), exceptions, today());
    expect(ok).toBe(false);
    expect(failures.some((f) => f.includes("days after today"))).toBe(true);
  });

  it("moderate and low advisories never fail", () => {
    let report = withAdvisory(fixture(), "222222", { severity: "moderate", findings: [], references: [] });
    report = withAdvisory(report, "333333", { severity: "low", findings: [], references: [] });
    const { ok, failures } = evaluateAudit(report, [], today());
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it("unknown severity is treated like low (never fails)", () => {
    const { ok } = evaluateAudit(withAdvisory(fixture(), "444444", { findings: [], references: [] }), [], today());
    expect(ok).toBe(true);
  });
});
