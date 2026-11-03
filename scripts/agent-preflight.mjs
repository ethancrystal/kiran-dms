#!/usr/bin/env node
/**
 * Kiran DMS agent preflight (docs/AGENT-COMPLIANCE-PROTOCOL.md §10).
 * A read-only tripwire: checks the governance files and references, and reports branch and
 * worktree state. It writes nothing and cannot prove that an agent read or understood anything.
 *
 * Modes:
 *   (none)  local startup: exit 1 on any finding, including work on local main or master
 *   --ci    GitHub Actions: same file checks; the branch is not checked (CI checks out a detached ref)
 *   --hook  Claude Code SessionStart: always exit 0 (a failing SessionStart hook only shows a notice);
 *           prints a short report and tells the agent what to read. It does not paste the protocol:
 *           the protocol must be read in full anyway, so pasting it would load it twice.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const POLICY_PATH = "docs/AGENT-COMPLIANCE-PROTOCOL.md";
const ACTIVITY_PATH = "docs/ACTIVITY.md";
const APPENDIX_A_HEADING = "## Appendix A";

// Claude Code caps a hook's plain stdout at 10,000 characters (longer output becomes a file path the
// agent is not told to read). The hook is far below this; the test suite keeps it under 2,500.
export const HOOK_OUTPUT_LIMIT = 2500;

// The SessionStart hook in .claude/settings.json, in exec form: no shell, so it behaves the same
// under Git Bash and PowerShell on Windows, and ${CLAUDE_PROJECT_DIR} makes it independent of the
// directory the session starts in. Not on "resume": a resumed conversation already holds the
// earlier output, so firing again would only duplicate it.
export const HOOK_MATCHER = "startup|clear|compact";
export const HOOK_COMMAND = "node";
export const HOOK_ARGS = ["${CLAUDE_PROJECT_DIR}/scripts/agent-preflight.mjs", "--hook"];

const REQUIRED_SECTIONS = [
  ["## 2. Required startup sequence", "its mandatory startup sequence"],
  ["## 11. Untrusted content and prompt-injection defence", "its untrusted-content and prompt-injection section"],
];

const REQUIRED_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  POLICY_PATH,
  ACTIVITY_PATH,
  ".claude/settings.json",
  ".gitignore",
  "package.json",
  "scripts/agent-preflight.mjs",
  "scripts/agent-preflight.test.mjs",
  ".github/workflows/agent-compliance.yml",
];

// Local Claude Code state that must never be committed (worktrees are full checkouts).
const REQUIRED_IGNORES = [".claude/settings.local.json", ".claude/worktrees/"];

function readText(root, relativePath) {
  try {
    return readFileSync(resolve(root, relativePath), "utf8");
  } catch {
    return null;
  }
}

/** Text of the "## Appendix A" section, up to the next "## " heading; null when absent. */
export function appendixA(activity) {
  const lines = activity.split("\n");
  const start = lines.findIndex((line) => line.startsWith(APPENDIX_A_HEADING));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

function hookIsInstalled(settings) {
  const groups = settings?.hooks?.SessionStart;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) =>
      group.matcher === HOOK_MATCHER &&
      (group.hooks ?? []).some(
        (hook) =>
          hook.type === "command" &&
          hook.command === HOOK_COMMAND &&
          Array.isArray(hook.args) &&
          hook.args.length === HOOK_ARGS.length &&
          hook.args.every((arg, i) => arg === HOOK_ARGS[i]),
      ),
  );
}

export function validatePolicyFiles(root) {
  const errors = [];
  for (const relativePath of REQUIRED_FILES) {
    if (!existsSync(resolve(root, relativePath))) {
      errors.push(`Required file is missing: ${relativePath}`);
    }
  }

  const agents = readText(root, "AGENTS.md");
  const claude = readText(root, "CLAUDE.md");
  for (const [name, contents] of [
    ["AGENTS.md", agents],
    ["CLAUDE.md", claude],
  ]) {
    if (contents === null) continue;
    if (!contents.includes(POLICY_PATH)) errors.push(`${name} does not reference ${POLICY_PATH}`);
    if (!contents.includes(ACTIVITY_PATH)) errors.push(`${name} does not reference ${ACTIVITY_PATH}`);
    if (!contents.includes("pnpm agent:preflight")) {
      errors.push(`${name} does not instruct agents to run pnpm agent:preflight`);
    }
  }
  if (agents !== null && claude !== null && agents !== claude) {
    errors.push("AGENTS.md and CLAUDE.md differ; the repository convention requires identical root instructions.");
  }

  const activity = readText(root, ACTIVITY_PATH);
  if (activity !== null) {
    const appendix = appendixA(activity);
    if (appendix === null) errors.push(`${ACTIVITY_PATH} has no "${APPENDIX_A_HEADING}" section`);
    else if (!appendix.includes(POLICY_PATH)) errors.push(`${ACTIVITY_PATH} Appendix A must reference ${POLICY_PATH}`);
  }

  const packageJsonText = readText(root, "package.json");
  if (packageJsonText !== null) {
    try {
      const pkg = JSON.parse(packageJsonText);
      if (pkg.scripts?.["agent:preflight"] !== "node scripts/agent-preflight.mjs") {
        errors.push("package.json must define agent:preflight as node scripts/agent-preflight.mjs");
      }
      if (pkg.scripts?.["agent:preflight:test"] !== "node --test scripts/agent-preflight.test.mjs") {
        errors.push("package.json must define agent:preflight:test as node --test scripts/agent-preflight.test.mjs");
      }
    } catch {
      errors.push("package.json could not be parsed as JSON");
    }
  }

  const settingsText = readText(root, ".claude/settings.json");
  if (settingsText !== null) {
    try {
      if (!hookIsInstalled(JSON.parse(settingsText))) {
        errors.push(
          `.claude/settings.json must have a SessionStart command hook: matcher "${HOOK_MATCHER}", command "${HOOK_COMMAND}", args ${JSON.stringify(HOOK_ARGS)}`,
        );
      }
    } catch {
      errors.push(".claude/settings.json is not valid JSON");
    }
  }

  const gitignore = readText(root, ".gitignore");
  if (gitignore !== null) {
    const lines = new Set(gitignore.split(/\r?\n/).map((line) => line.trim()));
    for (const pattern of REQUIRED_IGNORES) {
      if (!lines.has(pattern)) errors.push(`.gitignore must contain the line ${pattern}`);
    }
  }

  const policy = readText(root, POLICY_PATH);
  if (policy !== null) {
    for (const [heading, what] of REQUIRED_SECTIONS) {
      if (!policy.includes(heading)) errors.push(`${POLICY_PATH} is missing ${what}`);
    }
  }

  return errors;
}

export function validateBranch(branch, { ci = false } = {}) {
  if (ci) return [];
  if (!branch) return ["Git branch could not be determined; do not work from a detached HEAD."];
  if (branch === "main" || branch === "master") {
    return [`Current branch is '${branch}'. Switch to an authorized feature branch before making changes.`];
  }
  return [];
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return { ok: false, text: (result.stderr || result.error?.message || "git command failed").trim() };
  }
  return { ok: true, text: result.stdout.trimEnd() };
}

const MAX_WORKTREE_LINES = 8;

/**
 * The report shared by every mode. Deliberately short: CLAUDE.md is already in an agent's context,
 * so this states facts the agent cannot get from it (branch, worktree, wiring) and nothing it repeats.
 */
export function buildReport(root, { ci = false, hook = false } = {}) {
  const errors = validatePolicyFiles(root);
  const branchResult = git(root, ["branch", "--show-current"]);
  const statusResult = git(root, ["status", "--short"]);
  const branch = branchResult.ok ? branchResult.text.trim() : "";

  if (!branchResult.ok) errors.push(`Unable to inspect current Git branch: ${branchResult.text}`);
  if (!statusResult.ok) errors.push(`Unable to inspect Git worktree: ${statusResult.text}`);
  errors.push(...validateBranch(branch, { ci }));

  const mode = ci ? "CI" : hook ? "SessionStart" : "local";
  const out = [`KIRAN DMS AGENT PREFLIGHT (${mode}, read-only). Branch: ${branch || "UNKNOWN (detached HEAD?)"}`];
  if (statusResult.ok) {
    const lines = statusResult.text ? statusResult.text.split("\n") : [];
    if (lines.length === 0) out.push("Worktree: clean.");
    else {
      out.push(`Worktree: ${lines.length} change(s); not yours to discard, preserve them:`);
      out.push(...lines.slice(0, MAX_WORKTREE_LINES));
      if (lines.length > MAX_WORKTREE_LINES) out.push(`... and ${lines.length - MAX_WORKTREE_LINES} more (git status)`);
    }
  }
  if (errors.length) {
    out.push("PREFLIGHT BLOCKED. Edit nothing until each item is fixed or logged as a BLOCKER for MJ:");
    for (const error of errors) out.push(`- ${error}`);
  } else {
    out.push("PREFLIGHT OK: governance files and references are in place.");
  }
  return { lines: out, errors };
}

/**
 * SessionStart context. It does not paste the protocol or repeat CLAUDE.md: the protocol and
 * ACTIVITY.md must be read in full anyway (CLAUDE.md says so), so pasting any of it here would load
 * the same text twice.
 */
export function buildHookContext(root) {
  const { lines, errors } = buildReport(root, { hook: true });
  lines.push(
    `Read ${POLICY_PATH} and ${ACTIVITY_PATH} before any edit, then log SESSION-START and CLAIM (as CLAUDE.md says). Re-run pnpm agent:preflight once you are on your feature branch.`,
  );
  return { text: lines.join("\n"), errors };
}

function run() {
  const args = new Set(process.argv.slice(2));
  const ci = args.has("--ci");
  const hook = args.has("--hook");
  if (hook) {
    const { text } = buildHookContext(ROOT);
    process.stdout.write(`${text}\n`);
    return; // exit 0: a non-zero SessionStart exit shows only a notice and would hide this context
  }
  const { lines, errors } = buildReport(ROOT, { ci });
  process.stdout.write(`${lines.join("\n")}\n`);
  if (errors.length) process.exitCode = 1;
}

function samePath(a, b) {
  try {
    const [x, y] = [realpathSync(a), realpathSync(b)];
    return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
  } catch {
    return false;
  }
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) run();
