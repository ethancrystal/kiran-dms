#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C (tightened per L-0025, L-0030,
 * L-0035, L-0042).
 *
 * This is a tripwire, not a proof: it catches mistakes and cheap evasions in a text file.
 * Branch protection and a human reviewer who is not the author remain the real control.
 * Rather than recognising every Markdown trick, ACTIVITY.md is held to a narrow structure:
 * no raw HTML, entities, comments or setext headings anywhere; the only lines that look
 * like entries are canonical entry headers; and new log text may contain no other headings.
 *
 * Fails (exit 1) when, between BASE and HEAD:
 *  0. BASE was given but cannot be resolved, or any git command fails (e.g. a diff too large
 *     to read) — the check fails closed. An all-zero sha falls back to HEAD~1;
 *  1. anything changed — any file other than ACTIVITY.md, or ACTIVITY.md outside §16 — but
 *     no new `### L-NNNN` entry was appended;
 *  2. structure or append-only broken: not exactly one §16 heading; HTML tags, entities,
 *     comments or setext underlines outside code; a line shaped like an entry ("… PKT · …")
 *     that is not a canonical header; the old log not an exact prefix of the new one; new
 *     text not starting with a header; any non-canonical heading in new text; a `---`
 *     separator other than as the final line (code blocks excepted);
 *  3. a new entry lacks signature, type, Task line or (DONE/VERIFIED/HANDOFF/PROGRESS)
 *     Evidence line; numbering not sequential; a Task line with non-ASCII characters outside
 *     a small allowlist;
 *  4. DONE/VERIFIED lacks the security checklist; a VERIFIED entry names no task, names a
 *     task with no DONE entry, or shares a signature (equal, contained, or same
 *     "session <id>") with any DONE entry for a task it names (§7, MJ ruling L-0029);
 *  5. an added line contains a secret-looking value, supplier/cost wording outside vault
 *     migrations, tests and docs, or an owner-listed sensitive term; or a file whose name
 *     starts with `.env` (other than `.env.example`) is added or changed.
 *
 * Usage: node scripts/activity-log-check.mjs [BASE] [HEAD]
 *   BASE defaults to origin/main, then main, then the root commit. HEAD defaults to the worktree.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const LOG_PATH = "docs/ACTIVITY.md";
const ENTRY_RE = /^### (L-(\d{4})) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) PKT · (.+?) · ([A-Z-]+)$/;
const TYPES = new Set([
  "SESSION-START", "CLAIM", "PROGRESS", "DECISION", "ASSUMPTION", "BLOCKER", "DEVIATION",
  "DONE", "VERIFIED", "HANDOFF", "CLAIM-RELEASED", "CORRECTION", "SECURITY-INCIDENT",
]);
const ZERO_WIDTH_G = /[​-‏⁠-⁤﻿­]/g;
const clean = (t) => t.normalize("NFKC").replace(ZERO_WIDTH_G, "");
// Non-ASCII characters a Task line may legitimately contain (en/em dash, section, not-equal, middle dot, times, ellipsis).
const TASK_LINE_ALLOWED = new Set(["–", "—", "§", "≠", "·", "×", "…"]);

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // A connection string with a password (any user, incl. empty; any +driver), except the local CLI stack and <pw>/… placeholders.
  /\bpostgres(?:ql)?(?:\+\w+)?:\/\/[^:\s/@]*:(?!postgres@127\.0\.0\.1|postgres@localhost|<|…)[^@\s]+@/i,
];
// name = value / name: value. The value is either a quoted string (measured in full) or a bare token.
const NAME = String.raw`([\w.-]*(?:secret|passw(?:or)?d|pass|pwd|token|api[_-]?key|private[_-]?key|secret[_-]?key|access[_-]?key|service[_-]?role[_-]?key))`;
const VALUE = String.raw`(?:String\(|Buffer\.from\(|encodeURIComponent\()?\s*(?:"([^"]*)"|'([^']*)'|` + "`([^`]*)`" + String.raw`|([^\s"'` + "`" + String.raw`,;)]+))`;
const ASSIGN_RE = new RegExp(String.raw`\b` + NAME + String.raw`\b["'` + "`" + String.raw`]?\s*[:=]\s*` + VALUE, "gi");
// Upper-case env-style *_KEY names (SUPABASE_KEY=...); case-sensitive so idempotency_key / data-key do not trip it.
const ENV_KEY_RE = new RegExp(String.raw`\b([A-Z][A-Z0-9_]*_KEY)\s*[:=]\s*` + VALUE, "g");
// References, not secrets. Quoted values: only <placeholder>, a whole ${...} template, or
// "env(NAME)" (Supabase config.toml). Bare values: also an UPPER_CASE $VAR / ${VAR}
// ("$Qx7m..." is a value), env(...), process.env, import.meta, secrets., a dotted property
// path, or any expression (calls, optional chaining, indexing).
const isReference = (v, quoted) => {
  if (/^<[^>]*>$/.test(v) || /^\$\{[^}]+\}$/.test(v) || /^env\([A-Z0-9_]+\)$/.test(v)) return true;
  if (quoted) return false;
  if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(v)) return true;
  if (/^(env\(|process\.env|import\.meta|secrets\.)/.test(v)) return true;
  if (/^[A-Za-z_$][\w$]*(\??\.[\w$]+)+$/.test(v)) return true;
  return /[(\[]|\?\./.test(v);
};
// In source code a bare value is an identifier or expression, never a literal secret; only
// quoted literals count there. Config/env/YAML/TOML files keep bare values.
const isCodeFile = (f) => /\.(m?[jt]sx?|cjs|cts)$/i.test(f);
const isPasswordName = (n) => /secret|pass|pwd|token/i.test(n);
// Password-like names: 12+ chars, or 8+ with a digit. Key-like names: 8+ with a digit, or
// 20+, unless the value is plainly a name made of lowercase words (e.g. a storage key
// "kiran.device.registering"), which real keys never are.
const looksSecret = (name, v) => isPasswordName(name)
  ? v.length >= 12 || (v.length >= 8 && /\d/.test(v))
  : v.length >= 8 && (/\d/.test(v) || v.length >= 20) && !/^[a-z]+([._\/-][a-z]+)*$/.test(v);
const secretAssignment = (text, file) => {
  for (const re of [ASSIGN_RE, ENV_KEY_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const quotedVal = m[2] ?? m[3] ?? m[4];
      if (quotedVal === undefined && isCodeFile(file)) continue;
      const value = quotedVal ?? m[5] ?? "";
      if (!isReference(value, quotedVal !== undefined) && looksSecret(m[1], value)) return m[1];
    }
  }
  return null;
};
// Supplier identity or cost wording outside the vault (H-01).
const SUPPLIER_RE = /\b(?:supplier\s*[:=]|(?:supplier_name|supplier_id|unit_cost|cost[_ ]price|landed[_ ]cost|manufacturer)\b)/i;  // activity-log-check:allow-supplier-pattern
const ALLOW_MARK = "activity-log-check:allow-supplier-pattern";
const DETECTORS = new Set(["scripts/activity-log-check.mjs", "supabase/tests/schema-hygiene.test.ts"]);
// Test code: supabase/tests/, any tests/ e2e/ __tests__/ directory, or *.test.* / *.spec.* files.
const isTestFile = (f) => /^supabase\/tests\//.test(f) || /(^|\/)(tests?|e2e|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const SUPPLIER_OK = (f) =>
  /^supabase\/migrations\/\d{14}_vault[a-z0-9_]*\.sql$/.test(f) || /^supabase\/tests\//.test(f) || f.startsWith("docs/");
const isEnvFile = (f) => { const b = (f.split("/").pop() ?? "").toLowerCase(); return b.startsWith(".env") && b !== ".env.example"; };
// Owner-listed terms, matched after removing invisible characters (zero-width splitting) and case.
const SENSITIVE_TERMS = (process.env.KIRAN_SENSITIVE_TERMS ?? "")
  .split(/\r?\n/).map((t) => t.normalize("NFKC").replace(/[​-‏⁠-⁤﻿­]/g, "").trim().toLowerCase()).filter((t) => t.length >= 3);
const termIn = (text) => {
  const low = text.normalize("NFKC").replace(/[​-‏⁠-⁤﻿­]/g, "").toLowerCase();
  return SENSITIVE_TERMS.some((t) => low.includes(t));
};

const errors = [];
const fail = (m) => errors.push(m);
// git without a shell (no cmd.exe escaping), raw UTF-8 paths, generous buffer; failures are reported, never swallowed.
const git = (args, { allowFail = false } = {}) => {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    if (allowFail) return null;
    fail(`git ${args.slice(0, 3).join(" ")} failed (${e.code ?? e.message}); refusing to pass (fails closed).`);
    return "";
  }
};

function resolveBase(arg) {
  if (arg) {
    if (/^0+$/.test(arg)) {
      const p = git(["rev-parse", "--verify", "HEAD~1^{commit}"], { allowFail: true });
      if (p) return p.trim();
      fail("Base is the all-zero sha and HEAD has no parent; cannot check.");
      return null;
    }
    const r = git(["rev-parse", "--verify", `${arg}^{commit}`], { allowFail: true });
    if (r) return r.trim();
    fail(`Base "${arg}" cannot be resolved; refusing to check (fails closed).`);
    return null;
  }
  const headSha = (git(["rev-parse", "HEAD"], { allowFail: true }) ?? "").trim();
  for (const c of ["origin/main", "main"]) {
    const s = git(["rev-parse", "--verify", `${c}^{commit}`], { allowFail: true });
    if (s && s.trim() !== headSha) return s.trim();
  }
  const root = git(["rev-list", "--max-parents=0", "HEAD"], { allowFail: true });
  return root ? root.trim().split("\n")[0] : null;
}

const base = resolveBase(process.argv[2]);
const head = process.argv[3] ?? "";
if (head && !git(["rev-parse", "--verify", `${head}^{commit}`], { allowFail: true })) fail(`Head "${head}" cannot be resolved.`);
const range = base ? [base, ...(head ? [head] : [])] : [];

// --- changed files (NUL-separated: no path quoting at all; renames split into delete + add)
const split0 = (s) => (s ?? "").split("\0").filter(Boolean);
let changed = range.length ? split0(git(["diff", "--no-renames", "--name-only", "-z", ...range])) : [];
const notDeleted = range.length ? split0(git(["diff", "--no-renames", "--name-only", "--diff-filter=d", "-z", ...range])) : [];
let untracked = [];
if (!head) untracked = split0(git(["ls-files", "--others", "--exclude-standard", "-z"]));
changed = [...new Set([...changed, ...untracked])];
for (const f of new Set([...notDeleted, ...untracked])) if (isEnvFile(f)) fail(`${f}: environment files must never be committed (H-20).`);

// --- Markdown structure
function scan(text) {
  const out = [];
  let fence = null;
  for (const l of text.split(/\r?\n/)) {
    // Only unindented fences count as code. An indented fence (e.g. inside a list item) may be
    // closed early by the renderer (L-0055 L1), so its lines are checked as ordinary text.
    const m = l.match(/^(`{3,}|~{3,})(.*)$/);
    if (!fence && m && !(m[1][0] === "`" && m[2].includes("`"))) {
      fence = { ch: m[1][0], len: m[1].length };
      out.push({ line: l, code: true });
      continue;
    }
    if (fence) {
      const c = l.match(/^(`{3,}|~{3,})\s*$/);
      if (c && c[1][0] === fence.ch && c[1].length >= fence.len) fence = null;
      out.push({ line: l, code: true });
      continue;
    }
    out.push({ line: l, code: false });
  }
  return out;
}
const stripInlineCode = (l) => l.replace(/(`+)[^`]*?\1/g, "");
const plain = (l) => clean(stripInlineCode(l)).replace(/\\/g, "");
const isSection16 = (l) => /^\s{0,3}#{1,6}\s*16\s*\.?\s*activity\s+log/i.test(plain(l));
const isHeading = (l) => /^\s{0,3}#{1,6}(\s|$)/.test(l);

function parseLog(text, label) {
  const sc = scan(text);
  // whole-file structural rules (outside code)
  for (let i = 0; i < sc.length; i++) {
    const x = sc[i];
    if (x.code) continue;
    const p = plain(x.line);
    if (/<!--|-->/.test(p)) { fail(`${label}: HTML comments are not allowed in ${LOG_PATH}.`); break; }
  }
  for (let i = 0; i < sc.length; i++) {
    const x = sc[i];
    if (x.code) continue;
    const p = plain(x.line);
    if (/<\/?[A-Za-z!?][^>]*>/.test(p)) fail(`${label}: raw HTML is not allowed in ${LOG_PATH} (line ${i + 1}).`);
    if (/&#?[A-Za-z0-9]+;/.test(p)) fail(`${label}: HTML entities are not allowed in ${LOG_PATH} (line ${i + 1}).`);
    if (/^ {0,3}(=+|-+)\s*$/.test(x.line) && i > 0 && !sc[i - 1].code && sc[i - 1].line.trim() !== "" && !/^ {0,3}(=+|-+)\s*$/.test(sc[i - 1].line)) {
      fail(`${label}: setext (underlined) headings are not allowed in ${LOG_PATH} (line ${i + 1}).`);
    }
    if (/PKT\s*·/.test(p) && !ENTRY_RE.test(x.line)) fail(`${label}: line ${i + 1} looks like a log entry header but is not canonical: "${x.line.slice(0, 80)}"`);
  }
  const heads = sc.map((x, i) => (!x.code && isSection16(x.line) ? i : -1)).filter((i) => i >= 0);
  if (text && heads.length !== 1) fail(`${label}: expected exactly one "## 16. Activity log" heading, found ${heads.length}.`);
  const start = heads[0] ?? -1;
  if (start === -1) return { logSc: [], entries: [], outside: text };
  let end = sc.findIndex((x, i) => i > start && !x.code && /^## Appendix\b/.test(x.line));
  if (end === -1) end = sc.length;
  const logSc = sc.slice(start, end);
  const entries = [];
  let cur = null;
  for (const x of logSc) {
    if (!x.code && ENTRY_RE.test(x.line)) {
      const m = x.line.match(ENTRY_RE);
      cur = { id: m[1], n: Number(m[2]), sig: m[4], type: m[5], body: [] };
      entries.push(cur);
      continue;
    }
    if (cur) cur.body.push(x.line);
  }
  const all = sc.map((x) => x.line);
  return { logSc, entries, outside: [...all.slice(0, start), ...all.slice(end)].join("\n") };
}

const headText = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
let baseText = "";
if (base) baseText = git(["show", `${base}:${LOG_PATH}`], { allowFail: true }) ?? "";
const H = parseLog(headText, "HEAD");
const B = baseText ? parseLog(baseText, "BASE") : { logSc: [], entries: [], outside: "" };
const newEntries = H.entries.filter((e) => !B.entries.some((b) => b.id === e.id));

// 1. any change needs a log entry (incl. ACTIVITY.md outside §16)
const outsideChanged = Boolean(baseText) && B.outside.trim() !== H.outside.trim();
const otherFiles = changed.filter((f) => f !== LOG_PATH);
if ((otherFiles.length || outsideChanged) && newEntries.length === 0) {
  fail(`${otherFiles.length} file(s) changed${outsideChanged ? " and ACTIVITY.md changed outside §16" : ""} but ${LOG_PATH} has no new log entry.`);
}

// 2. strictly append-only, and new text holds only canonical structure
if (baseText) {
  const nonBlank = (arr) => arr.filter((x) => x.line.trim() !== "");
  const baseLog = nonBlank(B.logSc);
  while (baseLog.length && !baseLog[baseLog.length - 1].code && baseLog[baseLog.length - 1].line.trim() === "---") baseLog.pop();
  const headLog = nonBlank(H.logSc);
  let ok = true;
  for (let i = 0; i < baseLog.length; i++) {
    if (headLog[i]?.line !== baseLog[i].line) {
      fail(`Log section (§16) is not append-only at existing line ${i + 1}: expected "${baseLog[i].line.slice(0, 70)}", found "${(headLog[i]?.line ?? "<end of log>").slice(0, 70)}".`);
      ok = false;
      break;
    }
  }
  if (ok) {
    const rest = headLog.slice(baseLog.length);
    while (rest.length && !rest[rest.length - 1].code && rest[rest.length - 1].line.trim() === "---") rest.pop();
    if (rest.length && !ENTRY_RE.test(rest[0].line)) fail(`New log text must start with a new entry header; found "${rest[0].line.slice(0, 70)}" appended to the last existing entry.`);
    for (const x of rest) {
      if (x.code) continue;
      if (x.line.trim() === "---") fail("A `---` separator may appear only as the last line of the log.");
      if (isHeading(x.line) && !ENTRY_RE.test(x.line)) fail(`New log text may not contain headings other than entry headers: "${x.line.slice(0, 70)}"`);
      if (/^\s+(`{3,}|~{3,})/.test(x.line)) fail(`New log text may not contain indented code fences (they end early inside lists): "${x.line.slice(0, 70)}"`);
    }
  }
}

// 3 + 4. numbering, required lines, maker ≠ checker
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
// Dashes are normalised so "P0–04" (en dash) is read as P0-04 and checked (L-0055 L2).
const taskText = (body) => taskLine(body).replace(/\*\*Claim:\*\*.*$/, "").replace(/[‐-―−]/g, "-");
const taskIds = (body) => [...taskText(body).matchAll(/\b(P\d-\d{2}|PLAN-\d{2})\b/g)].map((m) => m[1]);
// Something shaped like a task id that is not one, e.g. "PO-04" (letter O) or "P0 04".
const lookalikeTaskIds = (body) => [...taskText(body).replace(/\b(P\d-\d{2}|PLAN-\d{2})\b/g, " ")
  .matchAll(/\bP\s?[A-Za-z0-9]\s?-?\s?\d{2}\b/g)].map((m) => m[0]);
for (const e of newEntries) {
  const body = e.body.join("\n");
  if (!TYPES.has(e.type)) fail(`${e.id}: unknown entry type "${e.type}".`);
  if (e.sig.split(" · ").length < 3) fail(`${e.id}: signature must be "<agent> · <model> · <session/branch>".`);
  if ([...e.sig].some((ch) => ch.charCodeAt(0) > 0x7e && ch !== "·")) fail(`${e.id}: signature must be plain ASCII (apart from the · separators), so look-alike letters cannot impersonate another signer.`);
  if (!/\*\*Task:\*\*/.test(body)) fail(`${e.id}: missing **Task:** line.`);
  const odd = [...taskLine(body)].filter((ch) => ch.charCodeAt(0) > 0x7e && !TASK_LINE_ALLOWED.has(ch));
  if (odd.length) fail(`${e.id}: Task line contains disallowed characters (${[...new Set(odd)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(", ")}).`);
  if (["DONE", "VERIFIED", "HANDOFF", "PROGRESS"].includes(e.type) && !/\*\*Evidence:\*\*\s*\S/.test(body)) fail(`${e.id}: ${e.type} entry needs a non-empty **Evidence:** line.`);
  if (["DONE", "VERIFIED"].includes(e.type) && !/Security checklist/.test(body)) fail(`${e.id}: ${e.type} entry lacks the security checklist block.`);
  if (e.type === "VERIFIED") {
    const tasks = taskIds(body);
    if (tasks.length === 0) fail(`${e.id}: a VERIFIED entry must name at least one task id (P<phase>-<nn>) on its Task line.`);
    const fakes = lookalikeTaskIds(body);
    if (fakes.length) fail(`${e.id}: Task line has text shaped like a task id that is not one (${fakes.join(", ")}); write task ids as P<phase>-<nn>.`);
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
let diff = range.length ? git(["diff", "--no-renames", "--text", "--no-ext-diff", "--unified=0", ...range]) : "";
for (const f of untracked) {
  try {
    const body = readFileSync(f, "utf8").split(/\r?\n/).map((l) => `+${l}`).join("\n");
    diff += `\ndiff --git a/${f} b/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n${body}`;
  } catch (e) { fail(`${f}: cannot read untracked file (${e.code ?? e.message}); refusing to pass.`); }
}
const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p.replace(/\\([0-7]{3})/g, (_, o) => "\\u00" + parseInt(o, 8).toString(16).padStart(2, "0"))) : p);
let file = "";
let inHeader = false;
for (const l of diff.split("\n")) {
  if (l.startsWith("diff --git ")) {
    const m = l.match(/ ("b\/.+"|b\/.+)$/);
    file = m ? unquote(m[1]).replace(/^"?b\//, "") : "";
    inHeader = true;
    continue;
  }
  if (inHeader) {
    if (l.startsWith("+++ ")) {
      const m = l.match(/^\+\+\+ (.+)$/);
      if (m && m[1] !== "/dev/null") file = unquote(m[1]).replace(/^b\//, "");
    }
    if (l.startsWith("@@")) inHeader = false;
    continue;
  }
  if (!l.startsWith("+")) continue;
  const text = l.slice(1);
  for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${file}: added line matches secret pattern ${re}.`);
  if (!isTestFile(file)) {
    const named = secretAssignment(text, file);
    if (named) fail(`${file}: added line assigns a secret-looking value to "${named}" (H-20).`);
  }
  const allowed = DETECTORS.has(file) && text.includes(ALLOW_MARK);
  if (!SUPPLIER_OK(file) && !allowed && SUPPLIER_RE.test(text)) fail(`${file}: added line looks like supplier identity or cost data outside the vault (H-01): "${text.trim().slice(0, 80)}"`);
  if (termIn(text)) fail(`${file}: added line contains an owner-listed sensitive term (H-01).`);
}

// 5b. owner-listed terms in file paths, and UTF-16 text files (git shows them as binary
// noise, so their content is decoded and scanned in full) (L-0055 L3).
const readAdded = (f) => {
  if (!head) { try { return readFileSync(f); } catch { return null; } }
  try {
    return execFileSync("git", ["show", `${head}:${f}`], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 });
  } catch { return null; }
};
for (const f of new Set([...notDeleted, ...untracked])) {
  if (termIn(f)) fail(`${f}: file path contains an owner-listed sensitive term (H-01).`);
  const buf = readAdded(f);
  if (!buf || buf.length < 2) continue;
  let decoded = null;
  if (buf[0] === 0xff && buf[1] === 0xfe) decoded = buf.subarray(2).toString("utf16le");
  else if (buf[0] === 0xfe && buf[1] === 0xff) decoded = Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  else {
    const sample = buf.subarray(0, 4096);
    let oddNul = 0; let evenNul = 0;
    for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddNul++ : evenNul++);
    const half = sample.length / 2;
    if (oddNul > half * 0.3 && evenNul < half * 0.05) decoded = sample.length ? buf.toString("utf16le") : null;
    else if (evenNul > half * 0.3 && oddNul < half * 0.05) decoded = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2))).swap16().toString("utf16le");
  }
  if (decoded === null) continue;
  for (const text of decoded.split(/\r?\n/)) {
    for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${f} (UTF-16): line matches secret pattern ${re}.`);
    if (!isTestFile(f)) { const named = secretAssignment(text, f); if (named) fail(`${f} (UTF-16): line assigns a secret-looking value to "${named}" (H-20).`); }
    if (termIn(text)) fail(`${f} (UTF-16): line contains an owner-listed sensitive term (H-01).`);
  }
}

if (errors.length) {
  console.error("activity-log-check FAILED:\n - " + [...new Set(errors)].join("\n - "));
  process.exit(1);
}
const plural = newEntries.length === 1 ? "entry" : "entries";
console.log(`activity-log-check OK (${newEntries.length} new log ${plural}, ${changed.length} changed files).`);
