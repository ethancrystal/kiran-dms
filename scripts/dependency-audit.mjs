#!/usr/bin/env node
// H-18 / doc 06 section 10.8: dependency advisories must not ship to the field.
// Reads the real `pnpm audit --json --prod` payload on stdin, fails on any high or critical
// advisory that has no unexpired, reasoned exception, and never exits zero with a real finding.
//
//   node scripts/dependency-audit.mjs [--exceptions <file>] [--today <YYYY-MM-DD>]
//   pnpm audit --json --prod | node scripts/dependency-audit.mjs
//
// report: the JSON parsed from stdin. exceptions: [{ id, reason, expires }] (expires is
// YYYY-MM-DD). today: YYYY-MM-DD (default: current UTC date). Prints one line per failure and
// exits non-zero when ok is false. Exported for the builder test: evaluateAudit.

const NAME_PATTERNS = [/high/i, /critical/i];

const argv = process.argv.slice(2);
// Accept both "--exceptions <path>" and "--exceptions=<path>".
const argValue = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at >= 0 && argv[at + 1]) return argv[at + 1];
  const prefixed = argv.find((a) => a.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
};
const exceptionsPath = argValue("--exceptions", "docs/security/audit-exceptions.json");
const today = argValue("--today", new Date().toISOString().slice(0, 10));

let exceptions = [];
try {
  const raw = await import("node:fs/promises").then((m) => m.readFile(exceptionsPath, "utf8"));
  exceptions = JSON.parse(raw).exceptions ?? [];
} catch (e) {
  console.error(`dependency-audit: cannot read exceptions file ${exceptionsPath} (${e.code ?? e.message})`);
  process.exit(2);
}

const maxExceptionAgeDays = 90;

export function evaluateAudit(report, exceptionsList, todayValue) {
  const todayDate = new Date(`${todayValue}T00:00:00Z`);
  const failures = [];
  if (report && typeof report === "object" && report.advisories && typeof report.advisories === "object") {
    for (const [id, advisory] of Object.entries(report.advisories)) {
      const severity = advisory?.severity ? String(advisory.severity).toLowerCase() : "unknown";
      if (!NAME_PATTERNS.some((re) => re.test(severity))) continue; // moderate / low never fail
      const match = exceptionsList.find((ex) => ex.id === id);
      if (!match) {
        failures.push(`advisory ${id} (severity ${severity}) has no exception`);
        continue;
      }
      if (!match.reason || !String(match.reason).trim()) {
        failures.push(`advisory ${id} has an exception with an empty reason`);
        continue;
      }
      const expires = Number.isInteger(Date.parse(match.expires)) ? new Date(`${match.expires}T00:00:00Z`) : null;
      if (!expires || Number.isNaN(expires.getTime())) {
        failures.push(`advisory ${id} has an exception with a bad expires date`);
        continue;
      }
      if (expires.getTime() < todayDate.getTime()) {
        failures.push(`advisory ${id} has an expired exception (expires ${match.expires})`);
        continue;
      }
      const days = Math.floor((expires.getTime() - todayDate.getTime()) / 86400000);
      if (days > maxExceptionAgeDays) {
        failures.push(`advisory ${id} has an exception that expires ${days} days after today`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

const stdin = process.stdin;
const chunks = [];
stdin.on("data", (c) => chunks.push(c));
stdin.on("end", () => {
  let report = null;
  try {
    report = JSON.parse(chunks.join(""));
  } catch (e) {
    console.error(`dependency-audit: cannot parse audit JSON on stdin (${e.message})`);
    process.exit(2);
  }
  const { ok, failures } = evaluateAudit(report, exceptions, today);
  for (const f of failures) console.error(`dependency-audit: ${f}`);
  if (!ok) process.exit(1);
});
stdin.resume();
