#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C (tightened per L-0025, L-0030,
 * L-0035, L-0042).
 *
 * This is a tripwire, not a proof: it catches mistakes and cheap evasions in a text file.
 * Branch protection and MJ's approval in chat for each merge remain the real control
 * (docs/ACTIVITY.md section 10; no second reviewer is required, MJ L-0401).
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
 *     "session <id>") with any DONE entry for a task it names and has no non-empty
 *     "**Self-verification:**" line (§7: a builder may verify its own work but must say so,
 *     MJ L-0401, replacing the maker-differs rule of L-0029);
 *     4b. a §12 board row (read as GitHub renders the table) changes its Status to anything
 *     mentioning VERIFIED other than exactly "VERIFIED (L-nnnn)" (a reopen note "was VERIFIED
 *     L-nnnn" excepted), a changed Status cell has non-ASCII outside the allowlist or Markdown
 *     marks, a task has two board rows, or the cited entry is not a VERIFIED or CORRECTION
 *     entry naming the task, with the checklist, newer than its latest DONE (L-0116), and with
 *     a "**Self-verification:**" line if it is signed by the same agent as a DONE for the task;
 *  5. an added line contains a secret-looking value, supplier/cost wording outside vault
 *     migrations, tests and docs, or an owner-listed sensitive term; or a file whose name
 *     starts with `.env` (other than `.env.example`) is added or changed. Secret patterns,
 *     owner terms (lines and paths), the UTF-16/UTF-32 decodings and the `.env` rule also run
 *     on every commit in the range, merges included as combined diffs (L-0105, L-0116).
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
  // A password as a URI query parameter, or in a libpq keyword string (L-0075 D5), unless it is a
  // placeholder or a ${…}/$VAR reference.
  /[?&;]\s*(?:password|passwd|pwd|pass)=(?!<|\{|\$|\*{3}|…)[^&\s"'`;]{6,}/i,
  /(?:^|[\s"'`])(?:password|passwd|pwd)=(?!<|\{|\$|\*{3}|…)[^&\s"'`;]{6,}/i,
  // A libpq keyword string ("host=… user=… password = value", spaces or single quotes allowed;
  // L-0085 P0-09 D3). Needs another libpq keyword on the line, so code such as
  // "password = req.body.password" is not caught here.
  { test: (t) => {
      if (!/\b(?:host|hostaddr|dbname|user|port|sslmode)\s*=\s*\S/i.test(t)) return false;
      for (const m of t.matchAll(/\b(?:password|passwd|pwd)\s*=\s*(?:'([^']*)'|([^\s'"`;&]+))/gi)) {
        const v = m[1] ?? m[2] ?? "";
        if (v.length >= 6 && !/^(<|\{|\$|\*{3}|…)/.test(v)) return true;
      }
      return false;
    }, toString: () => "libpq password keyword" },
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
  if (quoted && v.includes("${")) return true; // template literal built from other values, e.g. `Bearer ${token}`
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
// Password-like names: 12+ chars, or 8+ with a digit. Key-like names: 8+ with a digit, or 20+.
// Never a secret, whatever the name: a multi-part name made of lowercase words (a storage key such
// as "kiran.auth.token.v1"; L-0066 F-B). For token-named constants that are not passwords, a value
// with whitespace or parentheses is data, e.g. a design token "oklch(0.7 0.1 240)" (L-0066 F-D).
const looksSecret = (name, v) => {
  if (isNameLike(v) && !/secret|pass|pwd/i.test(name)) return false; // passwords keep the strict rule ("hunter2.hunter2")
  if (/token/i.test(name) && !/secret|pass|pwd/i.test(name) && /[\s()]/.test(v)) return false;
  return isPasswordName(name)
    ? v.length >= 12 || (v.length >= 8 && /\d/.test(v))
    : v.length >= 8 && (/\d/.test(v) || v.length >= 20);
};
// A name, not a key: two or more segments joined by . _ / - :, each a lowercase word with up to
// four trailing digits (fy2026), a 4-digit year, or a version like v1 (e.g. "kiran.outbox.v1",
// "kiran:outbox:v1", "kiran.invoice.fy2026"; L-0066 F-C). A single word ("sunshine2024") is not.
// Segments may also be short numbers ("3", "01", "2026") or a letter plus digits ("a5", "v2"),
// as long as at least one segment is a real word of 2+ letters (L-0071 F: "receipt-a5-v2",
// "salons-page-3", "kiran-outbox-2026-01").
function isNameLike(v) {
  const segs = v.split(/[._\/:-]/);
  if (segs.length >= 2
    && segs.some((seg) => /^[a-z]{2,16}\d{0,4}$/.test(seg))
    && segs.every((seg) => /^[a-z]{2,16}\d{0,4}$/.test(seg) || /^\d{1,4}$/.test(seg) || /^[a-z]\d{1,3}$/.test(seg))) return true;
  // Mixed-case names made of whole words ("NotoNastaliqUrdu-Regular", "KiranOutboxEncryptedV1";
  // L-0075 FP5): every segment splits exactly into capitalised words of 3+ letters, lowercase
  // words of 3+ letters, short acronyms ("UI" in "NotoNaskhArabicUI-Regular", L-0085 FP1), whole
  // numbers of up to 4 digits or a V-version of up to 3, with at least two real words in all.
  // Digit runs are taken whole, so "KiranSms903718264519" is not a name (L-0085 D4).
  let words = 0;
  for (const seg of segs) {
    const parts = seg.match(/[A-Z]{2,3}(?=[A-Z][a-z]|[^A-Za-z]|$)|[A-Z][a-z]{2,}|[a-z]{3,}|[Vv]\d+|\d+/g) ?? [];
    if (parts.join("") !== seg) return false;
    for (const p of parts) {
      if (/^[Vv]\d+$/.test(p) ? p.length > 4 : /^\d+$/.test(p) && p.length > 4) return false;
    }
    words += parts.filter((p) => /[a-z]/.test(p)).length;
  }
  return words >= 2;
}
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
// The password-name heuristic also skips UI text (i18n/locale files) and Markdown prose, where
// "password" is a label or a word. The hard patterns (keys, JWTs, connection strings) still apply.
const skipsNameHeuristic = (f) => isTestFile(f) || /(^|\/)(i18n|locales?|translations)\//.test(f) || /\.mdx?$/i.test(f);
// Supplier wording is also legitimate in the owner's vault UI (any path with a `vault/` directory
// segment, doc 07 / P1-05) and in i18n labels (MJ approval, B-21 / L-0080). Real supplier names
// are still caught everywhere by the owner-listed terms.
const SUPPLIER_OK = (f) =>
  /^supabase\/migrations\/\d{14}_vault[a-z0-9_]*\.sql$/.test(f) || /^supabase\/tests\//.test(f) || f.startsWith("docs/")
  || (/(^|\/)vault\//.test(f) && !/(^|\/)public\//.test(f))   // not under public/: served without sign-in (MJ, B-23 / L-0091)
  || /(^|\/)(i18n|locales?|translations)\//.test(f);
const isEnvFile = (f) => { const b = (f.split("/").pop() ?? "").toLowerCase(); return b.startsWith(".env") && b !== ".env.example"; };
// Owner-listed terms, matched after NFKC and removing every Unicode default-ignorable code point
// (zero-width, combining grapheme joiner, variation selectors, tag characters) and case (L-0061 D5).
const INVISIBLE_G = /\p{Default_Ignorable_Code_Point}/gu;
const termNorm = (t) => t.normalize("NFKC").replace(INVISIBLE_G, "").toLowerCase();
const SENSITIVE_TERMS = (process.env.KIRAN_SENSITIVE_TERMS ?? "")
  .split(/\r?\n/).map((t) => termNorm(t).trim()).filter((t) => t.length >= 3);
const termIn = (text) => { const low = termNorm(text); return SENSITIVE_TERMS.some((t) => low.includes(t)); };

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
// Each commit in the range, not only the net diff: an env file or a secret added in one commit
// and removed in a later one is still in git history (council audit 2026-10-27, finding 3).
// The structural rules (1 to 4) stay on the net diff; rule 5 and the env-file rule walk commits.
// Merge commits are included as combined diffs (--cc): for a merge, git lists only the files and
// lines that differ from every parent, so content added in a merge resolution is checked while a
// clean merge adds nothing (L-0116 D5).
const commitRange = base ? `${base}..${head || "HEAD"}` : null;
if (commitRange) {
  for (const f of new Set(split0(git(["log", "--cc", "--no-renames", "--diff-filter=AM", "--name-only", "-z", "--format=", commitRange])).map((p) => p.replace(/^\n+/, "")))) {
    if (isEnvFile(f)) fail(`${f}: environment files must never be committed, even in an intermediate commit (H-20).`);
  }
}

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
      // CommonMark: a closing fence may be indented up to 3 spaces (L-0061 D1) and followed only by
      // spaces or tabs; not by a no-break space or vertical tab, which JavaScript's \s matches (L-0085 D1).
      const c = l.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
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

// CommonMark autolinks (<https://…>, <name@host>) are links, not raw HTML (L-0075 FP4).
const AUTOLINK_RE = /<(?:https?:\/\/[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/g;

function parseLog(text, label) {
  // Rules added in L-0085 bind the new version only, so a base written under the older rules still parses.
  const isHead = label === "HEAD";
  // CommonMark ends a line at a lone CR too; the script splits on LF. A lone CR could therefore
  // hide a heading or close a fence for the renderer only (L-0075 D1). Refuse it anywhere.
  const loneCr = text.search(/\r(?!\n)/);
  if (loneCr !== -1) fail(`${label}: a carriage return not followed by a line feed is not allowed in ${LOG_PATH} (offset ${loneCr}).`);
  // Other control characters (vertical tab, form feed, ...) have no place in Markdown prose and
  // are read differently by JavaScript's \s and by CommonMark (L-0085 D1).
  const ctrl = text.search(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  if (isHead && ctrl !== -1) fail(`${label}: control characters other than tab and line breaks are not allowed in ${LOG_PATH} (offset ${ctrl}).`);
  const sc = scan(text);
  const heads = sc.map((x, i) => (!x.code && isSection16(x.line) ? i : -1)).filter((i) => i >= 0);
  const start = heads[0] ?? -1;
  let end = start === -1 ? -1 : sc.findIndex((x, i) => i > start && !x.code && /^## Appendix\b/.test(x.line));
  if (end === -1) end = sc.length;
  const inOldLogRange = (i) => !isHead || (start !== -1 && i > start && i < end);
  // whole-file structural rules (outside code)
  for (let i = 0; i < sc.length; i++) {
    const x = sc[i];
    if (x.code) continue;
    const p = plain(x.line);
    if (/<!--|-->/.test(p) || (!inOldLogRange(i) && /<!--|-->/.test(x.line))) { fail(`${label}: HTML comments are not allowed in ${LOG_PATH}.`); break; }
  }
  for (let i = 0; i < sc.length; i++) {
    const x = sc[i];
    if (x.code) continue;
    const p = plain(x.line);
    if (/<\/?[A-Za-z!?][^>]*>/.test(p.replace(AUTOLINK_RE, ""))) fail(`${label}: raw HTML is not allowed in ${LOG_PATH} (line ${i + 1}).`);
    if (/&#?[A-Za-z0-9]+;/.test(p)) fail(`${label}: HTML entities are not allowed in ${LOG_PATH} (line ${i + 1}).`);
    // Outside the §16 log (rules, tables, appendices; editable alongside any entry) the test runs
    // on the raw line, code spans and backslashes included, and needs no closing ">": a tag or
    // comment opener anywhere refuses the line, so neither an escaped backtick nor a tag split
    // over two lines hides HTML from it (L-0085 D2). Write placeholders as {name} there. New log
    // text has the stricter character rule in check 2; old log text was checked when it was added.
    if (!inOldLogRange(i) && /<[A-Za-z\/!?]|&#?[A-Za-z0-9]+;/.test(x.line.replace(AUTOLINK_RE, ""))) {
      fail(`${label}: raw HTML or an entity is not allowed outside the log in ${LOG_PATH}, even in code spans (line ${i + 1}; write placeholders as {name}).`);
    }
    if (/^ {0,3}(=+|-+)\s*$/.test(x.line) && i > 0 && !sc[i - 1].code && sc[i - 1].line.trim() !== "" && !/^ {0,3}(=+|-+)\s*$/.test(sc[i - 1].line)) {
      fail(`${label}: setext (underlined) headings are not allowed in ${LOG_PATH} (line ${i + 1}).`);
    }
    if (/PKT\s*[·⋅•∙・]/.test(p) && !ENTRY_RE.test(x.line)) fail(`${label}: line ${i + 1} looks like a log entry header but is not canonical: "${x.line.slice(0, 80)}"`);
  }
  if (text && heads.length !== 1) fail(`${label}: expected exactly one "## 16. Activity log" heading, found ${heads.length}.`);
  // Top-level section headings (# and ##, outside code), compared with the base below: a new
  // "## Appendix" heading would otherwise end §16 early and exempt the text after it (L-0085 D2).
  const sections = sc.filter((x) => !x.code && /^ {0,3}#{1,2}(\s|$)/.test(x.line)).map((x) => x.line.trim());
  if (start === -1) return { logSc: [], entries: [], outside: text, sections };
  for (let i = 0; i < sc.length; i++) {
    if ((i < start || i >= end) && !sc[i].code && ENTRY_RE.test(sc[i].line)) {
      fail(`${label}: entry header outside the §16 log (line ${i + 1}): "${sc[i].line.slice(0, 70)}"`); // L-0061 D2
    }
  }
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
  return { logSc, entries, outside: [...all.slice(0, start), ...all.slice(end)].join("\n"), sections };
}

const headText = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
let baseText = "";
if (base) baseText = git(["show", `${base}:${LOG_PATH}`], { allowFail: true }) ?? "";
const H = parseLog(headText, "HEAD");
const B = baseText ? parseLog(baseText, "BASE") : { logSc: [], entries: [], outside: "", sections: [] };
const newEntries = H.entries.filter((e) => !B.entries.some((b) => b.id === e.id));

// 1. any change needs a log entry (incl. ACTIVITY.md outside §16)
const outsideChanged = Boolean(baseText) && B.outside.trim() !== H.outside.trim();
const otherFiles = changed.filter((f) => f !== LOG_PATH);
if ((otherFiles.length || outsideChanged) && newEntries.length === 0) {
  fail(`${otherFiles.length} file(s) changed${outsideChanged ? " and ACTIVITY.md changed outside §16" : ""} but ${LOG_PATH} has no new log entry.`);
}

// 2. strictly append-only, and new text holds only canonical structure
if (baseText && B.sections.join("\n") !== H.sections.join("\n")) {
  fail(`The top-level section headings (# and ##) of ${LOG_PATH} may not be added, removed, renamed or reordered (L-0085 D2).`);
}
if (baseText) {
  // Exact prefix, blank lines included (L-0061 D7). Only the closing separator and the
  // trailing blank lines of the old log may move below the new entries.
  const baseLog = [...B.logSc];
  while (baseLog.length && !baseLog[baseLog.length - 1].code && /^(---)?\s*$/.test(baseLog[baseLog.length - 1].line)) baseLog.pop();
  const headLog = H.logSc;
  let ok = true;
  for (let i = 0; i < baseLog.length; i++) {
    if (headLog[i]?.line !== baseLog[i].line) {
      fail(`Log section (§16) is not append-only at existing line ${i + 1} of the log: expected "${baseLog[i].line.slice(0, 70)}", found "${(headLog[i]?.line ?? "<end of log>").slice(0, 70)}".`);
      ok = false;
      break;
    }
  }
  if (ok) {
    const rest = headLog.slice(baseLog.length).filter((x) => x.line.trim() !== "");
    while (rest.length && !rest[rest.length - 1].code && rest[rest.length - 1].line.trim() === "---") rest.pop();
    if (rest.length && !ENTRY_RE.test(rest[0].line)) fail(`New log text must start with a new entry header; found "${rest[0].line.slice(0, 70)}" appended to the last existing entry.`);
    for (const x of rest) {
      // Checked on code lines too: an indented fence can close a block early (L-0055 L1, L-0061 D1).
      if (/^\s+(`{3,}|~{3,})/.test(x.line)) fail(`New log text may not contain indented code fences: "${x.line.slice(0, 70)}"`);
      if (x.code) continue;
      if (x.line.trim() === "---") fail("A `---` separator may appear only as the last line of the log.");
      if (isHeading(x.line) && !ENTRY_RE.test(x.line)) fail(`New log text may not contain headings other than entry headers: "${x.line.slice(0, 70)}"`);
      // Peel off every container marker (blockquote ">" and list "-", "*", "+", "1." / "1)"),
      // however deeply nested, before testing (L-0061 D3, L-0066 A1).
      let inner = x.line;
      let quoted = false;
      let listed = false;
      for (;;) {
        const q = inner.match(/^\s{0,3}>\s?/);
        if (q) { quoted = true; inner = inner.slice(q[0].length); continue; }
        const li = inner.match(/^\s*([-*+]|\d+[.)])\s+/);
        if (li) { listed = true; inner = inner.slice(li[0].length); continue; }
        break;
      }
      if (quoted) fail(`New log text may not contain blockquotes: "${x.line.slice(0, 70)}"`);
      if (listed && isHeading(inner)) fail(`New log text may not contain headings inside list items: "${x.line.slice(0, 70)}"`);
      // A block can also sit inside a list item by indentation alone (4+ spaces, no marker on its
      // line). New log text is held to the strict reading: whatever the indentation, no heading,
      // blockquote or setext underline, and no non-canonical line pairing an L-nnnn id with PKT
      // (L-0071 E). Use fenced code blocks for examples.
      const bare = x.line.replace(/^\s+/, "");
      if (bare !== x.line) {
        if (/^#{1,6}(\s|$)/.test(bare)) fail(`New log text may not contain indented headings (they nest inside list items): "${x.line.slice(0, 70)}"`);
        if (/^>/.test(bare)) fail(`New log text may not contain indented blockquotes: "${x.line.slice(0, 70)}"`);
      }
      if (/^\s+(=+|-+)\s*$/.test(x.line)) fail(`New log text may not contain indented setext underlines: "${x.line.slice(0, 70)}"`);
      // No raw-HTML, entity or escape characters at all in new prose (L-0075 D2, D3): "<", "&" and
      // "\" are refused outside fenced code, whatever surrounds them, so no code-span or open-tag
      // trick can reach the renderer. CommonMark autolinks (<https://…>, <name@host>) are allowed.
      const noAutolinks = x.line.replace(AUTOLINK_RE, "");
      if (/[<&\\]/.test(noAutolinks)) fail(`New log text may not contain "<", "&" or "\\" outside fenced code (write URLs bare or as <https://…>, placeholders as {name}): "${x.line.slice(0, 70)}"`);
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
// A builder may verify its own work (MJ, L-0401) but must say so: a VERIFIED or CORRECTION entry
// signed by the same agent as a DONE for the task needs a non-empty **Self-verification:** line.
const declaresSelfVerification = (body) => /\*\*Self-verification:\*\*[ \t]*\S/.test(body);
const taskLine = (body) => (body.match(/\*\*Task:\*\*([^\n]*)/) || [])[1] ?? "";
// Dashes are normalised so "P0–04" (en dash) is read as P0-04 and checked (L-0055 L2).
const taskText = (body) => taskLine(body).replace(/\*\*Claim:\*\*.*$/, "").replace(/[‐-―−]/g, "-");
const taskIds = (body) => [...taskText(body).matchAll(/\b(P\d-\d{2}|PLAN-\d{2})\b/g)].map((m) => m[1]);
// Something shaped like a task id that is not one, e.g. "PO-04" (letter O) or "P0 04".
const lookalikeTaskIds = (body) => [...taskText(body).replace(/\b(P\d-\d{2}|PLAN-\d{2})\b/g, " ")
  .matchAll(/\bP[A-Za-z0-9]\s?[-_.]\s?[A-Za-z0-9]{1,3}\b|\bP[0-9O]\s[0-9Ol]{1,3}\b/g)].map((m) => m[0]); // P0-O4, P0-0l, PO-04, P0 04, P0-9, P0_09, P0.09; not "PR 12" (L-0061 D4, L-0085 D5)
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
        if (sameAgent(done.sig, e.sig) && !declaresSelfVerification(body)) fail(`${e.id}: VERIFIED by the same agent as DONE ${done.id} for ${task} ("${done.sig}") without a **Self-verification:** line; a builder verifying its own work must say so (MJ, L-0401).`);
      }
    }
  }
}

// 4b. A §12 board row that moves to VERIFIED must cite the verifying entry, and that entry is held
// to rule 4 whatever its type: it names the task, carries the security checklist, and is not
// signed by the agent behind any DONE entry for the task. (Verifiers record verdicts as
// CORRECTION or VERIFIED entries; before this, rule 4 ran only on entries typed VERIFIED, so no
// board move to VERIFIED was ever checked. Council audit 2026-10-27, finding 2.)
//
// The board is read the way GitHub renders it (L-0116 D2): a table opens at a header row followed
// by a delimiter row with the same number of cells and ends at a blank line or a heading; a row
// may be indented and may omit its outer pipes; cells split on unescaped pipes ("\|" is a pipe
// inside a cell); the Status column is found by its header, so extra cells (which GitHub drops)
// and escaped pipes cannot shift it. The task id cell is read after the same normalisation as a
// status, so "**P0-09**" is P0-09.
const MD_MARKS_RE = /[*_~`\\]/;
const normCell = (s) => s.normalize("NFKC").replace(INVISIBLE_G, "").replace(/\\(.)/g, "$1").replace(/[*_~`]/g, "")
  .replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
// Cells of a table row, and how many unescaped pipes it has (a backslash escapes the next character).
const rowOf = (line) => {
  const s = line.trim();
  const cells = [];
  let cur = "";
  let pipes = 0;
  let endsWithPipe = false;
  for (let i = 0; i < s.length; i++) {
    endsWithPipe = false;
    if (s[i] === "\\" && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
    if (s[i] === "|") { cells.push(cur); cur = ""; pipes++; endsWithPipe = true; continue; }
    cur += s[i];
  }
  cells.push(cur);
  if (s.startsWith("|")) cells.shift();
  if (endsWithPipe && s.length > 1) cells.pop();
  return { cells: cells.map((c) => c.trim()), pipes };
};
const splitRow = (line) => rowOf(line).cells;
const hasPipe = (l) => rowOf(l).pipes > 0;
const isDelimRow = (l) => hasPipe(l) && splitRow(l).every((c) => /^:?-+:?$/.test(c));
const boardOf = (text) => {
  const rows = [];   // recognised task rows: { task, status (raw, trimmed; null without a Status column), line }
  const lines = [];  // every line of §12 outside code, with whether it sits in a table and its row (if a task row)
  let inBoard = false;
  let table = null;  // { statusIdx }
  let prev = null;
  for (const x of scan(text)) {
    if (x.code) { table = null; prev = null; continue; }
    if (/^## /.test(x.line)) { inBoard = /^## 12\. /.test(x.line); table = null; prev = null; continue; }
    if (!inBoard) continue;
    const l = x.line;
    if (l.trim() === "" || /^\s{0,3}#{1,6}(\s|$)/.test(l)) { table = null; prev = null; lines.push({ line: l, inTable: false }); continue; }
    if (!table && prev !== null && isDelimRow(l) && splitRow(l).length === splitRow(prev).length) {
      table = { statusIdx: splitRow(prev).findIndex((c) => normCell(c) === "status") };
      lines.push({ line: l, inTable: true });
      continue;
    }
    let rec = null;
    if (table || hasPipe(l)) {
      const cells = splitRow(l);
      const id = normCell(cells[0] ?? "").toUpperCase();
      if (/^(P\d-\d{2}|PLAN-\d{2})$/.test(id) && table) {
        rec = { task: id, status: table.statusIdx >= 0 ? (cells[table.statusIdx] ?? "") : null, line: l };
        rows.push(rec);
      }
    }
    lines.push({ line: l, inTable: Boolean(table), rec });
    prev = l;
  }
  return { rows, lines };
};
if (baseText) {
  const B12 = boardOf(baseText);
  const H12 = boardOf(headText);
  const before = new Map();
  for (const r of B12.rows) if (!before.has(r.task)) before.set(r.task, r.status);
  const baseLines = new Set(B12.lines.map((x) => x.line.trim()));
  // D3: one row per task, so an earlier row cannot hide behind a later one.
  const seen = new Map();
  for (const r of H12.rows) seen.set(r.task, (seen.get(r.task) ?? 0) + 1);
  for (const [task, n] of seen) if (n > 1) fail(`§12 board: ${task} has ${n} rows; each task has exactly one board row (L-0116 D3).`);
  // A new or changed board line that mentions VERIFIED but is not a task row of a table with a
  // Status column (a look-alike id, a table without a Status header, a row outside any table).
  for (const x of H12.lines) {
    if (baseLines.has(x.line.trim()) || !(x.inTable || hasPipe(x.line))) continue;
    if (x.rec && x.rec.status !== null) continue;
    if (/verified/.test(normCell(x.line))) fail(`§12 board: a new or changed line mentions VERIFIED but is not a task row in a table with a Status column: "${x.line.trim().slice(0, 70)}"`);
  }
  for (const r of H12.rows) {
    const { task, status } = r;
    if (status === null) continue;
    if (before.has(task) && before.get(task) === status) continue; // unchanged (raw text, nothing looser)
    // D1: a changed Status cell is plain text: ASCII plus the Task-line allowlist, no Markdown
    // emphasis, code or escapes, so no rendering of VERIFIED can differ from the text tested here.
    const odd = [...status].filter((ch) => ch.charCodeAt(0) > 0x7e && !TASK_LINE_ALLOWED.has(ch));
    if (odd.length) { fail(`§12 board: ${task} has a changed Status cell with disallowed characters (${[...new Set(odd)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(", ")}); write statuses in plain ASCII (L-0116 D1).`); continue; }
    if (MD_MARKS_RE.test(status)) { fail(`§12 board: ${task} has a changed Status cell with Markdown emphasis, code or escape characters; write statuses as plain text (L-0116 D1).`); continue; }
    const ref = status.match(/^VERIFIED \((L-\d{4})\)$/);
    if (!ref) {
      // Normalised (NFKC, default-ignorables, emphasis, case): any VERIFIED other than the
      // canonical form is refused; the one exception is a reopen note "was VERIFIED L-nnnn".
      if (/verified/.test(normCell(status).replace(/\bwas verified l-\d{4}\b/g, ""))) {
        fail(`§12 board: ${task} has a changed Status cell that mentions VERIFIED; a move to VERIFIED must read exactly "VERIFIED (L-nnnn)" (a reopened task may say "was VERIFIED L-nnnn").`);
      }
      continue;
    }
    const v = H.entries.find((e) => e.id === ref[1]);
    if (!v) { fail(`§12 board: ${task} cites ${ref[1]} as its verification, but no such entry exists.`); continue; }
    const vBody = v.body.join("\n");
    if (!["VERIFIED", "CORRECTION"].includes(v.type)) fail(`§12 board: ${task} cites ${v.id}, a ${v.type} entry; a verification is a VERIFIED or CORRECTION entry.`);
    if (!taskIds(vBody).includes(task)) fail(`§12 board: ${task} cites ${v.id}, whose Task line does not name ${task}.`);
    if (!/Security checklist/.test(vBody)) fail(`§12 board: ${task} cites ${v.id}, which lacks the security checklist block.`);
    const dones = H.entries.filter((d) => d.type === "DONE" && taskIds(d.body.join("\n")).includes(task));
    if (dones.length === 0) fail(`§12 board: ${task} moved to VERIFIED but has no DONE entry.`);
    for (const done of dones) {
      if (sameAgent(done.sig, v.sig) && !declaresSelfVerification(vBody)) fail(`§12 board: ${task} is verified by ${v.id}, signed by the same agent as DONE ${done.id} ("${done.sig}"), without a **Self-verification:** line; a builder verifying its own work must say so (MJ, L-0401).`);
    }
    // D4: the verdict must be newer than the task's latest DONE entry (a reopened task needs a
    // fresh verification; MJ L-0110).
    const latest = dones.reduce((a, d) => (d.n > a.n ? d : a), dones[0] ?? { n: -1 });
    if (dones.length && v.n <= latest.n) fail(`§12 board: ${task} cites ${v.id}, which is older than its latest DONE entry ${latest.id}; a verification must come after the work it verifies (L-0116 D4).`);
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
// History pass (finding 3): every added line of every commit in the range gets the hard checks
// only (secret patterns and owner terms). The supplier-wording and name heuristics stay on the
// net diff, so a fixed false positive in an earlier commit cannot block a PR forever.
// Merges are read as combined diffs (--cc): a hunk header with N+1 "@" has N parent columns, and a
// line counts as added only when every column is "+" (new against every parent), so a clean merge
// contributes nothing (L-0116 D5). File headers are tracked as state, so "+++ " is skipped only
// between "diff --…" and the first hunk; an added content line starting "++ " is scanned (D6).
if (commitRange) {
  let hfile = "";
  let hHeader = false;
  let cols = 1;
  for (const l of git(["log", "-p", "--cc", "--no-renames", "--text", "--no-ext-diff", "--unified=0", "--format=", commitRange]).split("\n")) {
    if (l.startsWith("diff --git ")) { const m = l.match(/ ("b\/.+"|b\/.+)$/); hfile = m ? unquote(m[1]).replace(/^"?b\//, "") : ""; hHeader = true; cols = 1; continue; }
    const dc = l.match(/^diff --(?:cc|combined) (.+)$/);
    if (dc) { hfile = unquote(dc[1]); hHeader = true; continue; }
    const hunk = l.match(/^(@{2,}) /);
    if (hunk) { hHeader = false; cols = hunk[1].length - 1; continue; }
    if (hHeader) {
      if (l.startsWith("+++ ") && l.slice(4) !== "/dev/null") hfile = unquote(l.slice(4)).replace(/^b\//, "");
      continue;
    }
    if (!l.startsWith("+".repeat(cols))) continue;
    const text = l.slice(cols);
    for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${hfile}: a commit in the range adds a line matching secret pattern ${re} (git history keeps it even if a later commit removes it; rotate the secret).`);
    if (termIn(text)) fail(`${hfile}: a commit in the range adds a line containing an owner-listed sensitive term (H-01).`);
  }
}
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
  if (!skipsNameHeuristic(file)) {
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
const MAX_SCAN = 64 * 1024 * 1024;
// Every file is also decoded as UTF-16 in both byte orders and scanned in full, BOM or not
// (L-0061 D6). Ordinary UTF-8 text decodes to noise that these patterns do not match, so the
// hard patterns and owner terms run on both decodings. The password-name heuristic runs only
// when the file is recognisably UTF-16 (BOM, or the NUL pattern of mostly-ASCII UTF-16).
// Returns [decoded text, recognisably that encoding, label] triples.
function wideDecodings(buf) {
  const body = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2) : buf[0] === 0xfe && buf[1] === 0xff ? buf.subarray(2) : buf;
  const even = body.subarray(0, body.length - (body.length % 2));
  const le = even.toString("utf16le");
  const be = Buffer.from(even).swap16().toString("utf16le");
  let nul = 0;
  for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) nul++;
  const looksUtf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff) || nul > Math.min(buf.length, 4096) * 0.15;
  // A file starting with a UTF-32 byte-order mark is also decoded as UTF-32 and scanned in full,
  // with the name heuristic too, since the mark makes it recognisable (MJ, B-24 / L-0091).
  const utf32 = (buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0 && buf[3] === 0) ? "le"
    : (buf[0] === 0 && buf[1] === 0 && buf[2] === 0xfe && buf[3] === 0xff) ? "be" : null;
  const decodings = [[le, looksUtf16, "UTF-16"], [be, looksUtf16, "UTF-16"]];
  if (utf32) {
    let u = "";
    for (let i = 4; i + 4 <= buf.length; i += 4) {
      const cp = utf32 === "le" ? buf.readUInt32LE(i) : buf.readUInt32BE(i);
      u += cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
    }
    decodings.push([u, true, "UTF-32"]);
  }
  return decodings;
}
for (const f of new Set([...notDeleted, ...untracked])) {
  if (termIn(f)) fail(`${f}: file path contains an owner-listed sensitive term (H-01).`);
  if (f.includes("�")) { fail(`${f}: file path is not valid UTF-8; refusing to pass (fails closed).`); continue; }
  const buf = readAdded(f);
  if (buf === null) { fail(`${f}: added file cannot be read for scanning; refusing to pass (fails closed, L-0075 D4).`); continue; }
  if (buf.length < 2) continue;
  if (buf.length > MAX_SCAN) { fail(`${f}: file too large to scan (> 64 MB); refusing to pass.`); continue; }
  for (const [decoded, named0, enc] of wideDecodings(buf)) {
    for (const text of decoded.split(/\r?\n/)) {
      for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${f} (${enc}): line matches secret pattern ${re}.`);
      if (named0 && !skipsNameHeuristic(f)) { const named = secretAssignment(text, f); if (named) fail(`${f} (${enc}): line assigns a secret-looking value to "${named}" (H-20).`); }
      if (termIn(text)) fail(`${f} (${enc}): line contains an owner-listed sensitive term (H-01).`);
    }
  }
}

// 5c. The same for every commit in the range, merges included (combined: only files that differ
// from every parent): owner terms in the path of every file added or changed in any commit, so
// a path deleted or renamed away later is still caught (L-0116 D8), and the UTF-16 / UTF-32
// decodings of every blob any commit adds, so a wide-encoded secret removed later is caught
// (L-0116 D7). Hard checks only (secret patterns, owner terms), like the line history pass.
if (commitRange) {
  const recs = (git(["log", "--cc", "--raw", "--no-renames", "--no-abbrev", "-z", "--format=", commitRange]) ?? "").split("\0");
  const blobs = new Map(); // blob sha -> a path it was added at
  for (let i = 0; i < recs.length; i++) {
    const meta = recs[i].replace(/^\n+/, "");
    if (!meta.startsWith(":")) continue;
    const p = recs[++i] ?? "";
    const parts = meta.replace(/^:+/, "").split(" ");
    const shas = parts.filter((x) => /^[0-9a-f]{40,64}$/.test(x));
    const modes = parts.filter((x) => /^\d{6}$/.test(x));
    const sha = shas[shas.length - 1] ?? "";
    const mode = modes[modes.length - 1] ?? "";
    if (!sha || /^0+$/.test(sha)) continue; // deleted by this commit
    if (termIn(p)) fail(`${p}: a commit in the range adds a file whose path contains an owner-listed sensitive term (H-01; git history keeps the path).`);
    if (p.includes("�")) fail(`${p}: a commit in the range adds a path that is not valid UTF-8; refusing to pass (fails closed).`);
    if (mode === "160000") continue; // a submodule commit, not a blob
    if (!blobs.has(sha)) blobs.set(sha, p);
  }
  // Sizes first (one process), then contents in chunks so a large range cannot exhaust memory.
  const shas = [...blobs.keys()];
  const sizes = new Map();
  if (shas.length) {
    const out = (() => {
      try {
        return execFileSync("git", ["cat-file", "--batch-check"], { input: shas.join("\n") + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
      } catch (e) { fail(`git cat-file --batch-check failed (${e.code ?? e.message}); refusing to pass (fails closed).`); return ""; }
    })();
    for (const line of out.split("\n")) {
      const m = line.match(/^([0-9a-f]{40,64}) (\S+) (\d+)$/);
      if (m) sizes.set(m[1], { type: m[2], size: Number(m[3]) });
    }
  }
  let chunk = [];
  let chunkBytes = 0;
  const flush = () => {
    if (!chunk.length) return;
    let out;
    try {
      out = execFileSync("git", ["cat-file", "--batch"], { input: chunk.join("\n") + "\n", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 });
    } catch (e) { fail(`git cat-file --batch failed (${e.code ?? e.message}); refusing to pass (fails closed).`); chunk = []; chunkBytes = 0; return; }
    let pos = 0;
    while (pos < out.length) {
      const nl = out.indexOf(0x0a, pos);
      if (nl === -1) break;
      const m = out.subarray(pos, nl).toString("utf8").match(/^([0-9a-f]{40,64}) (\S+) (\d+)$/);
      if (!m) { fail(`git cat-file --batch returned an unexpected header; refusing to pass (fails closed).`); break; }
      const size = Number(m[3]);
      const buf = out.subarray(nl + 1, nl + 1 + size);
      pos = nl + 1 + size + 1;
      if (buf.length < 2) continue;
      const f = blobs.get(m[1]) ?? m[1];
      for (const [decoded, , enc] of wideDecodings(buf)) {
        for (const text of decoded.split(/\r?\n/)) {
          for (const re of SECRET_PATTERNS) if (re.test(text)) fail(`${f} (${enc}): a commit in the range adds a file with a line matching secret pattern ${re} (git history keeps it even if a later commit removes it; rotate the secret).`);
          if (termIn(text)) fail(`${f} (${enc}): a commit in the range adds a file with a line containing an owner-listed sensitive term (H-01).`);
        }
      }
    }
    chunk = [];
    chunkBytes = 0;
  };
  for (const sha of shas) {
    const info = sizes.get(sha);
    if (!info || info.type !== "blob") { fail(`${blobs.get(sha)}: a blob added in the range cannot be read for scanning; refusing to pass (fails closed).`); continue; }
    if (info.size > MAX_SCAN) { fail(`${blobs.get(sha)}: a file added in the range is too large to scan (> 64 MB); refusing to pass.`); continue; }
    if (chunkBytes + info.size > 256 * 1024 * 1024) flush();
    chunk.push(sha);
    chunkBytes += info.size;
  }
  flush();
}

if (errors.length) {
  console.error("activity-log-check FAILED:\n - " + [...new Set(errors)].join("\n - "));
  process.exit(1);
}
const plural = newEntries.length === 1 ? "entry" : "entries";
console.log(`activity-log-check OK (${newEntries.length} new log ${plural}, ${changed.length} changed files).`);
// Say how many owner terms were checked, so an empty KIRAN_SENSITIVE_TERMS is visible rather than
// silently passing (council audit finding 7; failing closed waits on B-15a, see B-26).
console.log(`owner terms checked: ${SENSITIVE_TERMS.length}${SENSITIVE_TERMS.length ? "" : " (KIRAN_SENSITIVE_TERMS is empty: supplier names are not being blocked)"}`);
