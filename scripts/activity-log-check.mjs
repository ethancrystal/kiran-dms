#!/usr/bin/env node
/**
 * activity-log-check — implements docs/ACTIVITY.md Appendix C.
 *
 * Fails (exit 1) when, between BASE and HEAD:
 *  1. files outside docs/ changed but docs/ACTIVITY.md gained no new `### L-NNNN` entry;
 *  2. the diff of docs/ACTIVITY.md removes or modifies a line inside §16 (the log);
 *  3. a new log entry has a duplicate / non-sequential number, or lacks signature,
 *     type, Task line, or (for DONE/VERIFIED/HANDOFF/PROGRESS) an Evidence line;
 *  4. a DONE/VERIFIED entry lacks the security checklist block, or a VERIFIED entry
 *     carries the same agent signature as the DONE entry for the same task;
 *  5. the diff contains secret-looking patterns.
 *
 * Usage: node scripts/activity-log-check.mjs [BASE] [HEAD]
 *   BASE defaults to origin/main, then main, then the root commit. HEAD defaults to the worktree.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const LOG_PATH = "docs/ACTIVITY.md";
const ENTRY_RE = /^### (L-(\d{4})) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) PKT · (.+?) · ([A-Z-]+)\s*$/;
const TYPES = new Set([
  "SESSION-START", "CLAIM", "PROGRESS", "DECISION", "ASSUMPTION", "BLOCKER", "DEVIATION",
  "DONE", "VERIFIED", "HANDOFF", "CLAIM-RELEASED", "CORRECTION", "SECURITY-INCIDENT",
]);
const SECRET_PATTERNS = [
  /service_role["']?\s*[:=]\s*["']?eyJ/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

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
if (!head) {
  try { changed.push(...sh("git ls-files --others --exclude-standard").split("\n").filter(Boolean)); } catch { /* ignore */ }
}
changed = [...new Set(changed)];
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

// 2. the log section is append-only: every base line must survive, in order
if (baseText) {
  const baseLog = B.logLines.filter((l) => l.trim() !== "");
  const headLog = H.logLines.filter((l) => l.trim() !== "");
  let j = 0;
  for (const bl of baseLog) {
    while (j < headLog.length && headLog[j] !== bl) j++;
    if (j === headLog.length) { fail(`Log section (§16) line removed or modified: "${bl.slice(0, 80)}"`); break; }
    j++;
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
for (const e of newEntries) {
  const body = e.body.join("\n");
  if (!TYPES.has(e.type)) fail(`${e.id}: unknown entry type "${e.type}".`);
  if (e.sig.split(" · ").length < 3) fail(`${e.id}: signature must be "<agent> · <model> · <session/branch>".`);
  if (!/\*\*Task:\*\*/.test(body)) fail(`${e.id}: missing **Task:** line.`);
  if (["DONE", "VERIFIED", "HANDOFF", "PROGRESS"].includes(e.type) && !/\*\*Evidence:\*\*\s*\S/.test(body)) {
    fail(`${e.id}: ${e.type} entry needs a non-empty **Evidence:** line.`);
  }
  // 4. checklist block and maker ≠ checker
  if (["DONE", "VERIFIED"].includes(e.type)) {
    if (!/Security checklist/.test(body)) fail(`${e.id}: ${e.type} entry lacks the security checklist block.`);
    if (e.type === "VERIFIED") {
      const task = (body.match(/\*\*Task:\*\*\s*(P\d-\d{2}|PLAN-\d{2})/) || [])[1];
      const done = task && H.entries.find((d) => d.type === "DONE" && d.body.join("\n").includes(`**Task:** ${task}`));
      if (done && agentOf(done.sig) === agentOf(e.sig)) {
        fail(`${e.id}: VERIFIED by the same agent (${agentOf(e.sig)}) that logged DONE (${done.id}) for ${task}; maker must differ from checker.`);
      }
    }
  }
}

// 5. secrets in the diff
let diff = "";
try { diff = sh(`git diff ${range}`); } catch { /* ignore */ }
for (const re of SECRET_PATTERNS) if (re.test(diff)) fail(`Diff matches secret pattern ${re}.`);

if (errors.length) {
  console.error("activity-log-check FAILED:\n - " + errors.join("\n - "));
  process.exit(1);
}
const plural = newEntries.length === 1 ? "entry" : "entries";
console.log(`activity-log-check OK (${newEntries.length} new log ${plural}, ${changed.length} changed files).`);
