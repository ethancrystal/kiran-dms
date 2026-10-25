#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C (tightened per L-0025, L-0030).
 *
 * Fails (exit 1) when, between BASE and HEAD:
 *  1. any file other than docs/ACTIVITY.md changed (added, modified, deleted or renamed,
 *     including docs/) but ACTIVITY.md gained no new `### L-NNNN` entry;
 *  2. the §16 log is not strictly append-only: ACTIVITY.md must have exactly one §16
 *     heading and no HTML comments inside §16; the old log must be an exact prefix of the
 *     new one; anything after it must start with a new entry header (so the last existing
 *     entry cannot be extended); a `---` separator may appear only as the final line;
 *  3. any `### L-` line in §16 does not parse as an entry header, or numbering is not
 *     sequential, or a new entry lacks signature, type, Task line, or (for
 *     DONE/VERIFIED/HANDOFF/PROGRESS) an Evidence line;
 *  4. a DONE/VERIFIED entry lacks the security checklist block; a VERIFIED entry names no
 *     task id; or its signature equals, contains, or is contained in the signature of a
 *     DONE entry for ANY task it names (maker ≠ checker, §7);
 *  5. an added line (text or binary, diff attributes ignored) contains a secret-looking
 *     value, supplier/cost wording outside vault migrations, or a term from the
 *     owner-maintained KIRAN_SENSITIVE_TERMS CI secret; or a `.env*` file other than
 *     `.env.example` is added.
 *
 * Usage: node scripts/activity-log-check.mjs [BASE] [HEAD]
 *   BASE defaults to origin/main, then main, then the root commit. HEAD defaults to the worktree.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const LOG_PATH = "docs/ACTIVITY.md";
const ENTRY_RE = /^### (L-(\d{4})) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) PKT · (.+?) · ([A-Z-]+)$/;
const TYPES = new Set([
  "SESSION-START", "CLAIM", "PROGRESS", "DECISION", "ASSUMPTION", "BLOCKER", "DEVIATION",
  "DONE", "VERIFIED", "HANDOFF", "CLAIM-RELEASED", "CORRECTION", "SECURITY-INCIDENT",
]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,                                      // any PEM private key, incl. ENCRYPTED
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,        // any JWT
  /\bAKIA[0-9A-Z]{16}\b/,
  // A connection string with a password, to anything but the local CLI stack; <pw> / … are placeholders.
  /\bpostgres(?:ql)?:\/\/[^:\s/@]+:(?!postgres@127\.0\.0\.1|postgres@localhost|<|…)[^@\s]+@/i,
];
// name = value / name: value for secret-looking names (any case: env, TOML, YAML, JSON, code).
const ASSIGN_RE = /\b([\w.-]*(?:secret|passw(?:or)?d|pass|pwd|token|api[_-]?key|private[_-]?key|service[_-]?role[_-]?key|[_-]key))\b["']?\s*[:=]\s*["']?([^\s"'`,;)]+)/gi;
// A value is a reference, not a secret: <placeholder>, ${...}/$VAR, env(...), process.env,
// import.meta, or a dotted property path such as en.data.totp.secret.
const isReference = (v) => /^(<|\$|env\(|process\.env|import\.meta)/.test(v) || /^[A-Za-z_$][\w$]*(\.[\w$]+)+$/.test(v);
// Looks like a real secret: at least 8 chars with a digit, or at least 20 chars.
const looksSecret = (v) => v.length >= 8 && (/\d/.test(v) || v.length >= 20);
const secretAssignment = (text) => {
  for (const m of text.matchAll(ASSIGN_RE)) if (!isReference(m[2]) && looksSecret(m[2])) return m[1];
  return null;
};
// Supplier identity or cost wording in code outside the vault (H-01).
const SUPPLIER_RE = /\b(?:supplier\s*[:=]|(?:supplier_name|supplier_id|unit_cost|cost[_ ]price|landed[_ ]cost|manufacturer)\b)/i;  // activity-log-check:allow-supplier-pattern
// Only these files may carry SUPPLIER_RE text, and only on lines marked with ALLOW_MARK.
const DETECTORS = new Set(["scripts/activity-log-check.mjs", "supabase/tests/schema-hygiene.test.ts"]);
const ALLOW_MARK = "activity-log-check:allow-supplier-pattern";
// Vault migrations are the one place supplier columns may exist: <timestamp>_vault*.sql.
const VAULT_MIGRATION = /^supabase\/migrations\/\d{14}_vault[a-z0-9_]*\.sql$/;
// Owner-maintained list (Appendix C rule 5), newline-separated, from a CI secret. Never committed.
const SENSITIVE_TERMS = (process.env.KIRAN_SENSITIVE_TERMS ?? "")
  .split(/\r?\n/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).trim();
// Normalise look-alike dashes so "P1‑01" (U+2011) cannot hide a task id.
const normDash = (t) => t.replace(/[‐-―−﹘﹣－]/g, "-");

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

// --- changed files (renames split into delete + add so the old path counts too)
let changed = [];
try { changed = sh(`git diff --no-renames --name-only ${range}`).split("\n").filter(Boolean); } catch { changed = []; }
let untracked = [];
if (!head) {
  try { untracked = sh("git ls-files --others --exclude-standard").split("\n").filter(Boolean); } catch { /* ignore */ }
}
changed = [...new Set([...changed, ...untracked])];
const needsEntry = changed.some((f) => f !== LOG_PATH);

// --- parse the §16 log section into entries
function parseLog(text, label) {
  const lines = text.split(/\r?\n/);
  const heads = lines.reduce((a, l, i) => (/^#{1,6}\s*16\.\s*Activity log/i.test(l) ? [...a, i] : a), []);
  if (text && heads.length !== 1) fail(`${label}: expected exactly one "## 16. Activity log" heading, found ${heads.length}.`);
  const start = heads[0] ?? -1;
  if (start === -1) return { logLines: [], entries: [], bad: [] };
  let end = lines.findIndex((l, i) => i > start && /^## (Appendix|\d+\.)/.test(l));
  if (end === -1) end = lines.length;
  const logLines = lines.slice(start, end);
  const entries = [];
  const bad = [];
  let cur = null;
  let inFence = false;
  for (const l of logLines) {
    if (/^```/.test(l)) inFence = !inFence;
    if (inFence) { if (cur) cur.body.push(l); continue; }
    if (l.startsWith("### L-")) {
      const m = l.match(ENTRY_RE);
      if (!m) { bad.push(l); cur = null; continue; }
      cur = { id: m[1], n: Number(m[2]), ts: m[3], sig: m[4], type: m[5], body: [] };
      entries.push(cur);
      continue;
    }
    if (cur) cur.body.push(l);
  }
  return { logLines, entries, bad };
}

const headText = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
let baseText = "";
if (base) { try { baseText = sh(`git show ${base}:${LOG_PATH}`); } catch { baseText = ""; } }
const H = parseLog(headText, "HEAD");
const B = baseText ? parseLog(baseText, "BASE") : { logLines: [], entries: [], bad: [] };
const newEntries = H.entries.filter((e) => !B.entries.some((b) => b.id === e.id));

// 1. any change needs a log entry
if (needsEntry && newEntries.length === 0) {
  fail(`${changed.filter((f) => f !== LOG_PATH).length} file(s) changed but ${LOG_PATH} has no new log entry.`);
}

// 2. strictly append-only
if (H.logLines.some((l) => l.includes("<!--") || l.includes("-->"))) fail("HTML comments are not allowed inside the §16 log.");
if (baseText) {
  const nonBlank = (arr) => arr.filter((l) => l.trim() !== "");
  const baseLog = nonBlank(B.logLines);
  while (baseLog.length && baseLog[baseLog.length - 1].trim() === "---") baseLog.pop(); // the closing separator moves down
  const headLog = nonBlank(H.logLines);
  let ok = true;
  for (let i = 0; i < baseLog.length; i++) {
    if (headLog[i] !== baseLog[i]) {
      fail(`Log section (§16) is not append-only at existing line ${i + 1}: expected "${baseLog[i].slice(0, 70)}", found "${(headLog[i] ?? "<end of log>").slice(0, 70)}".`);
      ok = false;
      break;
    }
  }
  if (ok) {
    const rest = headLog.slice(baseLog.length);
    while (rest.length && rest[rest.length - 1].trim() === "---") rest.pop();
    if (rest.length && !rest[0].startsWith("### L-")) {
      fail(`New log text must start with a new entry header; found "${rest[0].slice(0, 70)}" appended to the last existing entry.`);
    }
    if (rest.some((l) => l.trim() === "---")) fail("A `---` separator may appear only as the last line of the log.");
  }
}

// 3. headers, numbering and required lines
for (const l of H.bad) fail(`Malformed log entry header (must match the §16 template): "${l.slice(0, 90)}"`);
for (let i = 1; i < H.entries.length; i++) {
  if (H.entries[i].n !== H.entries[i - 1].n + 1) {
    fail(`Log numbering not sequential at ${H.entries[i].id} (previous ${H.entries[i - 1].id}).`);
  }
}
// A "different agent" is a different signature (§7; MJ ruling L-0029). Signatures that contain
// one another (e.g. the builder's plus " re-verify") count as the same agent.
const normSig = (sig) => normDash(sig).replace(/\s+/g, " ").trim().toLowerCase();
const sameAgent = (a, b) => { const x = normSig(a); const y = normSig(b); return x === y || x.includes(y) || y.includes(x); };
// Every task id on the entry's **Task:** line (e.g. "P1-01, P0-06 (SEC-01)    **Claim:** C-001").
const taskIds = (body) => {
  const line = normDash((body.match(/\*\*Task:\*\*([^\n]*)/) || [])[1] ?? "");
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
  }
  if (e.type === "VERIFIED") {
    const tasks = taskIds(body);
    if (tasks.length === 0) fail(`${e.id}: a VERIFIED entry must name at least one task id (P<phase>-<nn>) on its Task line.`);
    for (const task of tasks) {
      for (const done of H.entries.filter((d) => d.type === "DONE" && taskIds(d.body.join("\n")).includes(task))) {
        if (sameAgent(done.sig, e.sig)) {
          fail(`${e.id}: VERIFIED by the same agent as DONE ${done.id} for ${task} ("${done.sig}"); maker must differ from checker.`);
        }
      }
    }
  }
}

// 5. secrets and supplier identifiers in ADDED lines, parsed with real diff structure
let diff = "";
try { diff = sh(`git diff --no-renames --text --no-ext-diff --unified=0 ${range}`); } catch { /* ignore */ }
for (const f of untracked) {
  try {
    const body = readFileSync(f, "utf8").split(/\r?\n/).map((l) => `+${l}`).join("\n");
    diff += `\ndiff --git a/${f} b/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n${body}`;
  } catch { /* unreadable */ }
}
let file = "";
let inHeader = false;
for (const l of diff.split("\n")) {
  if (l.startsWith("diff --git ")) {
    const m = l.match(/ b\/(.+)$/);
    file = m ? m[1] : "";
    inHeader = true;
    if (/(^|\/)\.env(\.|$)/.test(file) && !/(^|\/)\.env\.example$/.test(file) && changed.includes(file)) {
      fail(`${file}: environment files must never be committed (H-20).`);
    }
    continue;
  }
  if (inHeader) {
    if (l.startsWith("+++ ")) { const m = l.match(/^\+\+\+ (?:b\/)?(.+)$/); if (m && m[1] !== "/dev/null") file = m[1]; }
    if (l.startsWith("@@")) inHeader = false;
    continue;
  }
  if (!l.startsWith("+")) continue;
  const text = l.slice(1);
  for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${file}: added line matches secret pattern ${re}.`);
  const named = secretAssignment(text);
  if (named) fail(`${file}: added line assigns a secret-looking value to "${named}" (H-20).`);
  const allowed = DETECTORS.has(file) && text.includes(ALLOW_MARK);
  if (!VAULT_MIGRATION.test(file) && !file.startsWith("docs/") && !allowed && SUPPLIER_RE.test(text)) {
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
