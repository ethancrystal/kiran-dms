#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C (tightened per L-0025, L-0030, L-0035).
 *
 * This is a tripwire, not a proof: it catches mistakes and cheap evasions in a text file.
 * Branch protection and a human reviewer who is not the author remain the real control.
 *
 * Fails (exit 1) when, between BASE and HEAD:
 *  0. BASE was given but cannot be resolved (fails closed; an all-zero sha means "first
 *     push" and falls back to HEAD~1);
 *  1. anything changed — any file other than ACTIVITY.md, or ACTIVITY.md outside its §16
 *     log (rules, board, claims, blockers, appendices) — but no new `### L-NNNN` entry;
 *  2. the §16 log is not strictly append-only: exactly one §16 heading in the file
 *     (loosely matched); no HTML comments anywhere in ACTIVITY.md (outside code); the old
 *     log is an exact prefix of the new one; new text starts with a new entry header; a
 *     `---` separator only as the final line;
 *  3. any header-like line (look-alike `#`, spacing, dashes, zero-width characters)
 *     does not parse as a canonical entry header; numbering not sequential; a new entry
 *     lacks signature, type, Task line or (DONE/VERIFIED/HANDOFF/PROGRESS) Evidence line;
 *     a Task line contains zero-width or non-Latin look-alike characters;
 *  4. DONE/VERIFIED lacks the security checklist; a VERIFIED entry names no task, names a
 *     task with no DONE entry, or shares a signature (equal, contained, or same
 *     "session <id>") with any DONE entry for a task it names (§7, MJ ruling L-0029);
 *  5. an added line (text or binary) contains a secret-looking value, supplier/cost
 *     wording outside vault migrations and tests, or an owner-listed sensitive term; or a
 *     `.env*` file other than `.env.example` is added.
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
const ZERO_WIDTH = /[​-‏⁠-⁤﻿­]/;
const ZERO_WIDTH_G = /[​-‏⁠-⁤﻿­]/g;
const DASHES_G = /[‐-―−﹘﹣－]/g;
const LOOKALIKE = /[Ͱ-ϿЀ-ӿԀ-ԯⰀ-ⱟＡ-ｚ]/; // Greek, Cyrillic, Glagolitic, fullwidth
const clean = (t) => t.normalize("NFKC").replace(ZERO_WIDTH_G, "").replace(DASHES_G, "-");

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // A connection string with a password (any user, incl. empty; any +driver), except the local CLI stack and <pw>/… placeholders.
  /\bpostgres(?:ql)?(?:\+\w+)?:\/\/[^:\s/@]*:(?!postgres@127\.0\.0\.1|postgres@localhost|<|…)[^@\s]+@/i,
];
// name = value / name: value. Group 1 = name, group 2 = value. Quotes of any kind, and
// common wrappers such as String("...") are skipped before the value.
const Q = "[\"'`]";
const ASSIGN_RE = new RegExp(
  String.raw`\b([\w.-]*(?:secret|passw(?:or)?d|pass|pwd|token|api[_-]?key|private[_-]?key|secret[_-]?key|access[_-]?key|service[_-]?role[_-]?key))\b` +
  Q + String.raw`?\s*[:=]\s*(?:String\(|Buffer\.from\(|encodeURIComponent\()?\s*` + Q + String.raw`?([^\s"'` + "`" + String.raw`,;)]+)`,
  "gi");
// Upper-case env-style *_KEY names (SUPABASE_KEY=...). Case-sensitive on purpose, so code
// identifiers such as idempotency_key or JSX data-key do not trip it.
const ENV_KEY_RE = /\b([A-Z][A-Z0-9_]*_KEY)\s*[:=]\s*["']?([^\s"'`,;)]+)/g;
const isReference = (v) => /^(<|\$|env\(|process\.env|import\.meta|secrets\.)/.test(v) || /^[A-Za-z_$][\w$]*(\.[\w$]+)+$/.test(v);
const isPasswordName = (n) => /secret|pass|pwd|token/i.test(n);
// Password-like names: 12+ chars, or 8+ with a digit. Key-like names: 8+ with a digit, or 20+.
const looksSecret = (name, v) => isPasswordName(name)
  ? v.length >= 12 || (v.length >= 8 && /\d/.test(v))
  : v.length >= 8 && (/\d/.test(v) || v.length >= 20);
const secretAssignment = (text) => {
  for (const re of [ASSIGN_RE, ENV_KEY_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (!isReference(m[2]) && looksSecret(m[1], m[2])) return m[1];
  }
  return null;
};
// Supplier identity or cost wording outside the vault (H-01).
const SUPPLIER_RE = /\b(?:supplier\s*[:=]|(?:supplier_name|supplier_id|unit_cost|cost[_ ]price|landed[_ ]cost|manufacturer)\b)/i;  // activity-log-check:allow-supplier-pattern
const ALLOW_MARK = "activity-log-check:allow-supplier-pattern";
const DETECTORS = new Set(["scripts/activity-log-check.mjs", "supabase/tests/schema-hygiene.test.ts"]);
// Places where supplier wording is legitimate: vault migrations, tests (which must name
// cost columns to prove they never leak), and docs. Owner-listed terms are enforced everywhere.
const SUPPLIER_OK = (f) =>
  /^supabase\/migrations\/\d{14}_vault[a-z0-9_]*\.sql$/.test(f) || /^supabase\/tests\//.test(f) || f.startsWith("docs/");
const SENSITIVE_TERMS = (process.env.KIRAN_SENSITIVE_TERMS ?? "")
  .split(/\r?\n/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).trim();
const errors = [];
const fail = (m) => errors.push(m);

function resolveBase(arg) {
  if (arg) {
    if (/^0+$/.test(arg)) {
      try { return sh('git rev-parse --verify "HEAD~1^{commit}"'); } catch { fail("Base is the all-zero sha and HEAD has no parent; cannot check."); return null; }
    }
    try { return sh(`git rev-parse --verify "${arg}^{commit}"`); } catch { fail(`Base "${arg}" cannot be resolved; refusing to check (fails closed).`); return null; }
  }
  for (const c of ["origin/main", "main"]) {
    try {
      const s = sh(`git rev-parse --verify "${c}^{commit}"`);
      if (sh("git rev-parse HEAD") !== s) return s;
    } catch { /* candidate missing */ }
  }
  try { return sh("git rev-list --max-parents=0 HEAD").split("\n")[0]; } catch { return null; }
}

const base = resolveBase(process.argv[2]);
const head = process.argv[3] ?? "";
if (process.argv[3]) { try { sh(`git rev-parse --verify "${head}^{commit}"`); } catch { fail(`Head "${head}" cannot be resolved.`); } }
const range = base ? `${base} ${head}`.trim() : "";

// --- changed files (renames split into delete + add)
let changed = [];
try { changed = sh(`git diff --no-renames --name-only ${range}`).split("\n").filter(Boolean); } catch { changed = []; }
let untracked = [];
if (!head) { try { untracked = sh("git ls-files --others --exclude-standard").split("\n").filter(Boolean); } catch { /* ignore */ } }
changed = [...new Set([...changed, ...untracked])];

// --- Markdown structure: CommonMark-style fences; inline code stripped where it matters
function scan(text) {
  const out = [];
  let fence = null;
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && m && !(m[1][0] === "`" && m[2].includes("`"))) {
      fence = { ch: m[1][0], len: m[1].length };
      out.push({ line: l, code: true });
      continue;
    }
    if (fence) {
      const c = l.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (c && c[1][0] === fence.ch && c[1].length >= fence.len) fence = null;
      out.push({ line: l, code: true });
      continue;
    }
    out.push({ line: l, code: false });
  }
  return out;
}
const stripInlineCode = (l) => l.replace(/(`+)[^`]*?\1/g, "");
const isSection16 = (l) => /^\s{0,3}#{1,6}\s*16\s*\.\s*activity\s+log/i.test(clean(l));
const headerLike = (l) => /^\s{0,3}#{1,6}\s*L\s*-?\s*\d/i.test(clean(l));

function parseLog(text, label) {
  const sc = scan(text);
  const heads = sc.map((x, i) => (!x.code && isSection16(x.line) ? i : -1)).filter((i) => i >= 0);
  if (text && heads.length !== 1) fail(`${label}: expected exactly one "## 16. Activity log" heading, found ${heads.length}.`);
  for (const x of sc) {
    if (!x.code && /<!--|-->/.test(stripInlineCode(x.line))) { fail(`${label}: HTML comments are not allowed in ${LOG_PATH}.`); break; }
  }
  const start = heads[0] ?? -1;
  if (start === -1) return { logLines: [], entries: [], bad: [], outside: text };
  let end = sc.findIndex((x, i) => i > start && !x.code && /^## (Appendix|\d+\.)/.test(x.line));
  if (end === -1) end = sc.length;
  const logSc = sc.slice(start, end);
  const entries = [];
  const bad = [];
  let cur = null;
  for (const x of logSc) {
    if (!x.code && headerLike(x.line)) {
      const m = x.line.match(ENTRY_RE);
      if (!m) { bad.push(x.line); cur = null; continue; }
      cur = { id: m[1], n: Number(m[2]), sig: m[4], type: m[5], body: [] };
      entries.push(cur);
      continue;
    }
    if (cur) cur.body.push(x.line);
  }
  const all = sc.map((x) => x.line);
  return { logLines: logSc.map((x) => x.line), entries, bad, outside: [...all.slice(0, start), ...all.slice(end)].join("\n") };
}

const headText = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
let baseText = "";
if (base) { try { baseText = sh(`git show ${base}:${LOG_PATH}`); } catch { baseText = ""; } }
const H = parseLog(headText, "HEAD");
const B = baseText ? parseLog(baseText, "BASE") : { logLines: [], entries: [], bad: [], outside: "" };
const newEntries = H.entries.filter((e) => !B.entries.some((b) => b.id === e.id));

// 1. any change needs a log entry (incl. ACTIVITY.md outside §16)
const outsideChanged = Boolean(baseText) && B.outside.trim() !== H.outside.trim();
const otherFiles = changed.filter((f) => f !== LOG_PATH);
if ((otherFiles.length || outsideChanged) && newEntries.length === 0) {
  fail(`${otherFiles.length} file(s) changed${outsideChanged ? " and ACTIVITY.md changed outside §16" : ""} but ${LOG_PATH} has no new log entry.`);
}

// 2. strictly append-only
if (baseText) {
  const nonBlank = (arr) => arr.filter((l) => l.trim() !== "");
  const baseLog = nonBlank(B.logLines);
  while (baseLog.length && baseLog[baseLog.length - 1].trim() === "---") baseLog.pop();
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
    if (rest.length && !rest[0].startsWith("### L-")) fail(`New log text must start with a new entry header; found "${rest[0].slice(0, 70)}" appended to the last existing entry.`);
    if (rest.some((l) => l.trim() === "---")) fail("A `---` separator may appear only as the last line of the log.");
  }
}

// 3 + 4. headers, numbering, required lines, maker ≠ checker
for (const l of H.bad) fail(`Malformed or look-alike log entry header (must match the §16 template exactly): "${l.slice(0, 90)}"`);
for (let i = 1; i < H.entries.length; i++) {
  if (H.entries[i].n !== H.entries[i - 1].n + 1) fail(`Log numbering not sequential at ${H.entries[i].id} (previous ${H.entries[i - 1].id}).`);
}
const normSig = (s) => clean(s).replace(/\s+/g, " ").trim().toLowerCase();
const sessionOf = (s) => (normSig(s).match(/\bsession\s+([0-9a-f]{6,})\b/) || [])[1] ?? null;
const sameAgent = (a, b) => {
  const x = normSig(a);
  const y = normSig(b);
  const sx = sessionOf(a);
  return x === y || x.includes(y) || y.includes(x) || (sx !== null && sx === sessionOf(b));
};
const taskLine = (body) => (body.match(/\*\*Task:\*\*([^\n]*)/) || [])[1] ?? "";
const taskIds = (body) => [...clean(taskLine(body)).replace(/\*\*Claim:\*\*.*$/, "").matchAll(/\b(P\d-\d{2}|PLAN-\d{2})\b/g)].map((m) => m[1]);
for (const e of newEntries) {
  const body = e.body.join("\n");
  if (!TYPES.has(e.type)) fail(`${e.id}: unknown entry type "${e.type}".`);
  if (e.sig.split(" · ").length < 3) fail(`${e.id}: signature must be "<agent> · <model> · <session/branch>".`);
  if (!/\*\*Task:\*\*/.test(body)) fail(`${e.id}: missing **Task:** line.`);
  const tl = taskLine(body);
  if (ZERO_WIDTH.test(tl) || LOOKALIKE.test(tl)) fail(`${e.id}: Task line contains zero-width or look-alike characters.`);
  if (["DONE", "VERIFIED", "HANDOFF", "PROGRESS"].includes(e.type) && !/\*\*Evidence:\*\*\s*\S/.test(body)) fail(`${e.id}: ${e.type} entry needs a non-empty **Evidence:** line.`);
  if (["DONE", "VERIFIED"].includes(e.type) && !/Security checklist/.test(body)) fail(`${e.id}: ${e.type} entry lacks the security checklist block.`);
  if (e.type === "VERIFIED") {
    const tasks = taskIds(body);
    if (tasks.length === 0) fail(`${e.id}: a VERIFIED entry must name at least one task id (P<phase>-<nn>) on its Task line.`);
    for (const task of tasks) {
      const dones = H.entries.filter((d) => d.type === "DONE" && taskIds(d.body.join("\n")).includes(task));
      if (dones.length === 0) fail(`${e.id}: ${task} has no DONE entry to verify.`);
      for (const done of dones) {
        if (sameAgent(done.sig, e.sig)) fail(`${e.id}: VERIFIED by the same agent as DONE ${done.id} for ${task} ("${done.sig}"); maker must differ from checker.`);
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
    if (/(^|\/)\.env(\.|$)/.test(file) && !/(^|\/)\.env\.example$/.test(file) && changed.includes(file)) fail(`${file}: environment files must never be committed (H-20).`);
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
  if (!SUPPLIER_OK(file) && !allowed && SUPPLIER_RE.test(text)) fail(`${file}: added line looks like supplier identity or cost data outside the vault (H-01): "${text.trim().slice(0, 80)}"`);
  const low = text.toLowerCase();
  for (const term of SENSITIVE_TERMS) if (low.includes(term)) fail(`${file}: added line contains an owner-listed sensitive term (H-01).`);
}

if (errors.length) {
  console.error("activity-log-check FAILED:\n - " + [...new Set(errors)].join("\n - "));
  process.exit(1);
}
const plural = newEntries.length === 1 ? "entry" : "entries";
console.log(`activity-log-check OK (${newEntries.length} new log ${plural}, ${changed.length} changed files).`);
