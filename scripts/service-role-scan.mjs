#!/usr/bin/env node
// H-18: the Supabase service-role / secret key must never reach the web app or a shared package,
// in source or in the built client bundle. Replaces the CI grep that dropped any line containing
// "server-only", skipped apps/web/proxy.ts, next.config.ts and packages/, and hid read errors
// (council audit 2026-10-27, finding 1). Fails closed: an unreadable path, or nothing scanned,
// is a failure.
//
//   node scripts/service-role-scan.mjs [--bundle DIR] [root...]
//
// Source (default roots: apps packages; build output and node_modules skipped): any NAME of the
// key (SUPABASE_SERVICE_ROLE_KEY, service_role, *SECRET_KEY, sb_secret_) fails.
// Bundle (--bundle, e.g. apps/web/.next/static after `next build`): library code there mentions
// those names in its own comments, so only key VALUES fail: an sb_secret_ key, a JWT whose
// payload carries role service_role, or the literal value of SUPABASE_SERVICE_ROLE_KEY /
// SUPABASE_SECRET_KEY when either is set in the environment.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const NAME_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /service[_-]?role[_-]?key/i,
  /\bservice_role\b/,
  /\b[A-Z0-9_]*SECRET_KEY\b/,
  /\bsb_secret_/,
];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "out", "dist", "coverage"]);
const TEXT = /\.(m?[jt]sx?|cjs|cts|json|css|html|md|ya?ml|toml|txt|map)$|^\.env/i;

const argv = process.argv.slice(2);
const bundles = [];
const roots = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--bundle") { if (!argv[i + 1]) { console.error("--bundle needs a directory"); process.exit(2); } bundles.push(argv[++i]); }
  else roots.push(argv[i]);
}
if (!roots.length) roots.push("apps", "packages");

const problems = [];
const hits = [];
let scanned = 0;

function walk(dir, skip, visit) {
  let names;
  try { names = readdirSync(dir); } catch (e) { problems.push(`${dir}: cannot read (${e.code ?? e.message})`); return; }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { problems.push(`${p}: cannot stat (${e.code ?? e.message})`); continue; }
    if (st.isDirectory()) { if (!skip.has(name)) walk(p, skip, visit); continue; }
    if (!TEXT.test(name)) continue;
    let text;
    try { text = readFileSync(p, "utf8"); } catch (e) { problems.push(`${p}: cannot read (${e.code ?? e.message})`); continue; }
    scanned++;
    visit(p, text);
  }
}

const sourceVisit = (p, text) => text.split(/\r?\n/).forEach((line, i) => {
  if (NAME_PATTERNS.some((re) => re.test(line))) hits.push(`${relative(".", p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
});

const envValues = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"].map((k) => process.env[k]).filter((v) => v && v.length >= 20);
const jwtRole = (jwt) => {
  try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).role; } catch { return null; }
};
const bundleVisit = (p, text) => {
  const where = relative(".", p);
  for (const m of text.matchAll(/\bsb_secret_[A-Za-z0-9_-]{16,}/g)) hits.push(`${where}: an sb_secret_ key value (${m[0].slice(0, 14)}…)`);
  for (const m of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (jwtRole(m[0]) === "service_role") hits.push(`${where}: a JWT with role service_role`);
  }
  for (const v of envValues) if (text.includes(v)) hits.push(`${where}: the configured secret key value`);
};

for (const r of roots) walk(r, SKIP_DIRS, sourceVisit);
for (const b of bundles) walk(b, new Set(), bundleVisit);
if (scanned === 0) problems.push("no files were scanned; refusing to pass");
if (hits.length || problems.length) {
  console.error("service-role scan FAILED (H-18):");
  for (const h of hits) console.error(`  key reference: ${h}`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`service-role scan OK: ${scanned} files under ${[...roots, ...bundles.map((b) => b + " (bundle)")].join(", ")}.`);
