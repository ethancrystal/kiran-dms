#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C.
 *
 * Fails (exit 1) when, between BASE and HEAD:
 *  1. files outside docs/ changed but docs/ACTIVITY.md gained no new `### L-NNNN` entry;
 *  2. the §16 log is not strictly append-only: the old log must be an exact prefix of the
 *     new one, so editing, removing, reordering or inserting above the last line all fail;
 *  3. a new log entry has a duplicate / non-sequential number, or lacks signature,
 *     type, Task line, or (for DONE/VERIFIED/HANDOFF/PROGRESS) an Evidence line;
 *  4. a DONE/VERIFIED entry lacks the security checklist block, or a VERIFIED entry has
 *     the same signature as a DONE entry for ANY task it names (maker ≠ checker, §7);
 *  5. an ADDED line contains a secret-looking value (keys, JWTs, connection strings with
 *     passwords, KEY=value secrets), supplier/cost wording outside vault paths, or a term
 *     from the owner-maintained list in the KIRAN_SENSITIVE_TERMS CI secret.
 *
 * Usage: node scripts/activity-log-check.mjs [BASE] [HEAD]
 *   BASE defaults to origin/main, then main, then the root commit. HEAD defaults to the worktree.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const LOG_PATH = "docs/ACTIVITY.md";
// Detector files hold the patterns themselves, so rule 5 does not scan them.
const DETECTORS = new Set(["scripts/activity-log-check.mjs", "supabase/tests/schema-hygiene.test.ts"]);
const ENTRY_RE = /^### (L-(\d{4})) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) PKT · (.+?) · ([A-Z-]+)\s*$/;
const TYPES = new Set([
  "SESSION-START", "CLAIM", "PROGRESS", "DECISION", "ASSUMPTION", "BLOCKER", "DEVIATION",
  "DONE", "VERIFIED", "HANDOFF", "CLAIM-RELEASED", "CORRECTION", "SECURITY-INCIDENT",
]);
const SECRET_PATTERNS = [
  /service_role["']?\s*[:=]\s*["']?eyJ/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // any JWT
  /\bAKIA[0-9A-Z]{16}\b/,
  // A connection string with a password, to anything but the local CLI stack.
  /\bpostgres(?:ql)?:\/\/[^:\s/@]+:(?!postgres@127\.0\.0\.1|postgres@localhost|<|…)[^@\s]+@/i, // <pw> or … = placeholder
  // KEY=value for secret-looking names, unless the value is a <placeholder>.
  /\b[A-Z0-9_]*(SECRET|PASSWORD|PASSWD|SERVICE_ROLE_KEY|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN)[A-Z0-9_]*\s*=\s*(?!<)[^\s#]{8,}/,
];
// Supplier identity or cost wording in code outside the vault (H-01).
const SUPPLIER_RE = /\b(?:supplier\s*[:=]|(?:supplier_name|supplier_id|unit_cost|cost[_ ]price|landed[_ ]cost|manufacturer)\b)/i;
// Owner-maintained list (Appendix C rule 5), newline-separated, from a CI secret. Never committed.
const SENSITIVE_TERMS = (process.env.KIRAN_SENSITIVE_TERMS ?? "")
  .split(/\r?\n/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();

function resolveBase(arg) {
  if (arg) return arg;
  for (const c of ["origin/main", "main"]) {
    try {
      sh(`git rev-parse --verify ${c}`);
      if (sh("git rev-parse HEAD") !== sh(`git rev-parse ${c}`)) return c;
    } catch { /* candidate missing */ }
  }
  try { return sh("git rev-list --max-parents=0 HEAD").split("\n")[0]; } catch { return null; }
}

const base = resolveBase(process.argv[2]);
const head = process.argv[3] ?? ""; // empty => compare against the worktree
const range = base ? `${base} ${head}`.trim() : "";
const errors = [];
const fail = (m) => errors.push(m);

// --- changed files
let changed = [];
try { changed = sh(`git diff --name-only ${range}`).split("\n").filter(Boolean); } catch { changed = []; }
let untracked = [];
if (!head) {
  try { untracked = sh("git ls-files --others --exclude-standard").split("\n").filter(Boolean); } catch { /* ignore */ }
}
changed = [...new Set([...changed, ...untracked])];
const codeChanged = changed.some((f) => !f.startsWith("docs/"));

// --- parse the §16 log section into entries
function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## 16\. Activity log/.test(l));
  if (start === -1) return { logLines: [], entries: [] };
  let end = lines.findIndex((l, i) => i > start && /^## (Appendix|\d+\.)/.test(l));
  if (end === -1) end = lines.length;
  const logLines = lines.slice(start, end);
  const entries = [];
  let cur = null;
  let inFence = false;
  for (const l of logLines) {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(ENTRY_RE);
    if (m) {
      cur = { id: m[1], n: Number(m[2]), ts: m[3], sig: m[4], type: m[5], body: [] };
      entries.push(cur);
      continue;
    }
    if (cur) cur.body.push(l);
  }
  return { logLines, entries };
}

const headText = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
let baseText = "";
if (base) { try { baseText = sh(`git show ${base}:${LOG_PATH}`); } catch { baseText = ""; } }
const H = parseLog(headText);
const B = parseLog(baseText);
const newEntries = H.entries.filter((e) => !B.entries.some((b) => b.id === e.id));

// 1. code changed without a log entry
if (codeChanged && newEntries.length === 0) {
  const n = changed.filter((f) => !f.startsWith("docs/")).length;
  fail(`${n} file(s) outside docs/ changed but ${LOG_PATH} has no new log entry.`);
}

// 2. strictly append-only: the base log (blank lines ignored) must be an exact prefix
//    of the head log. A trailing "---" separator line is allowed to move below new entries.
if (baseText) {
  const keep = (l) => l.trim() !== "" && l.trim() !== "---";
  const baseLog = B.logLines.filter(keep);
  const headLog = H.logLines.filter(keep);
  for (let i = 0; i < baseLog.length; i++) {
    if (headLog[i] !== baseLog[i]) {
      fail(`Log section (§16) is not append-only at existing line ${i + 1}: expected "${baseLog[i].slice(0, 70)}", found "${(headLog[i] ?? "<end of log>").slice(0, 70)}".`);
      break;
    }
  }
}

// 3. numbering and required lines
for (let i = 1; i < H.entries.length; i++) {
  if (H.entries[i].n !== H.entries[i - 1].n + 1) {
    fail(`Log numbering not sequential at ${H.entries[i].id} (previous ${H.entries[i - 1].id}).`);
  }
}
// A "different agent" is a different signature: another tool/model, another session, or a human (§7).
const agentOf = (sig) => sig.replace(/\s+/g, " ").trim();
// Every task id on the entry's **Task:** line (e.g. "P1-01, P0-06 (SEC-01)    **Claim:** C-001").
const taskIds = (body) => {
  const line = (body.match(/\*\*Task:\*\*([^\n]*)/) || [])[1] ?? "";
  return [...line.replace(/\*\*Claim:\*\*.*$/, "").matchAll(/\b(P\d-\d{2}|PLAN-\d{2})\b/g)].map((m) => m[1]);
};
for (const e of newEntries) {
  const body = e.body.join("\n");
  if (!TYPES.has(e.type)) fail(`${e.id}: unknown entry type "${e.type}".`);
  if (e.sig.split(" · ").length < 3) fail(`${e.id}: signature must be "<agent> · <model> · <session/branch>".`);
  if (!/\*\*Task:\*\*/.test(body)) fail(`${e.id}: missing **Task:** line.`);
  if (["DONE", "VERIFIED", "HANDOFF", "PROGRESS"].includes(e.type) && !/\*\*Evidence:\*\*\s*\S/.test(body)) {
    fail(`${e.id}: ${e.type} entry needs a non-empty **Evidence:** line.`);
  }
  // 4. checklist block and maker ≠ checker for every task named
  if (["DONE", "VERIFIED"].includes(e.type)) {
    if (!/Security checklist/.test(body)) fail(`${e.id}: ${e.type} entry lacks the security checklist block.`);
    if (e.type === "VERIFIED") {
      for (const task of taskIds(body)) {
        for (const done of H.entries.filter((d) => d.type === "DONE" && taskIds(d.body.join("\n")).includes(task))) {
          if (agentOf(done.sig) === agentOf(e.sig)) {
            fail(`${e.id}: VERIFIED by the same agent (${agentOf(e.sig)}) that logged DONE (${done.id}) for ${task}; maker must differ from checker.`);
          }
        }
      }
    }
  }
}

// 5. secrets and supplier identifiers in ADDED lines only
let diff = "";
try { diff = sh(`git diff --unified=0 ${range}`); } catch { /* ignore */ }
for (const f of untracked) {
  try {
    diff += `\n+++ b/${f}\n` + readFileSync(f, "utf8").split(/\r?\n/).map((l) => `+${l}`).join("\n");
  } catch { /* unreadable or binary */ }
}
let file = "";
for (const l of diff.split("\n")) {
  if (l.startsWith("+++ ")) { file = l.replace(/^\+\+\+ (b\/)?/, ""); continue; }
  if (!l.startsWith("+") || DETECTORS.has(file)) continue;
  const text = l.slice(1);
  for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${file}: added line matches secret pattern ${re}.`);
  if (!/vault/i.test(file) && !file.startsWith("docs/") && SUPPLIER_RE.test(text)) {
    fail(`${file}: added line looks like supplier identity or cost data outside the vault (H-01): "${text.trim().slice(0, 80)}"`);
  }
  const low = text.toLowerCase();
  for (const term of SENSITIVE_TERMS) if (low.includes(term)) fail(`${file}: added line contains an owner-listed sensitive term (H-01).`);
}

if (errors.length) {
  console.error("activity-log-check FAILED:\n - " + [...new Set(errors)].join("\n - "));
  process.exit(1);
}
const plural = newEntries.length === 1 ? "entry" : "entries";
console.log(`activity-log-check OK (${newEntries.length} new log ${plural}, ${changed.length} changed files).`);
