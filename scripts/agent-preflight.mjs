#!/usr/bin/env node
/**
 * Kiran DMS agent preflight.
 * A read-only tripwire: checks governance files/references and reports branch/worktree state.
 * It cannot prove that an agent read or understood the documents.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const POLICY_PATH = "docs/AGENT-COMPLIANCE-PROTOCOL.md";
const ACTIVITY_PATH = "docs/ACTIVITY.md";
const REQUIRED_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  POLICY_PATH,
  ACTIVITY_PATH,
  ".claude/settings.json",
  "package.json",
  "scripts/agent-preflight.mjs",
  "scripts/agent-preflight.test.mjs",
  ".github/workflows/agent-compliance.yml",
];

function readText(root, relativePath) {
  try {
    return readFileSync(resolve(root, relativePath), "utf8");
  } catch {
    return null;
  }
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
    if (!contents.includes(POLICY_PATH)) {
      errors.push(`${name} does not reference ${POLICY_PATH}`);
    }
    if (!contents.includes(ACTIVITY_PATH)) {
      errors.push(`${name} does not reference ${ACTIVITY_PATH}`);
    }
    if (!contents.includes("pnpm agent:preflight")) {
      errors.push(`${name} does not instruct agents to run pnpm agent:preflight`);
    }
  }
  if (agents !== null && claude !== null && agents !== claude) {
    errors.push("AGENTS.md and CLAUDE.md differ; the repository convention requires identical root instructions.");
  }

  const activity = readText(root, ACTIVITY_PATH);
  if (activity !== null && !activity.includes(POLICY_PATH)) {
    errors.push(`${ACTIVITY_PATH} Appendix A must reference ${POLICY_PATH}`);
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

  const hookText = readText(root, ".claude/settings.json");
  if (hookText !== null) {
    try {
      const settings = JSON.parse(hookText);
      const hooks = settings?.hooks?.SessionStart ?? [];
      const commandFound = hooks.some((entry) =>
        (entry.hooks ?? []).some((hook) => hook.type === "command" && hook.command === "node scripts/agent-preflight.mjs --hook"),
      );
      if (!commandFound) {
        errors.push(".claude/settings.json must have a SessionStart command hook for node scripts/agent-preflight.mjs --hook");
      }
    } catch {
      errors.push(".claude/settings.json is not valid JSON");
    }
  }

  const policy = readText(root, POLICY_PATH);
  if (policy !== null && !policy.includes("## 2. Required startup sequence")) {
    errors.push(`${POLICY_PATH} is missing its mandatory startup sequence`);
  }

  return errors;
}

export function validateBranch(branch, { ci = false, hook = false } = {}) {
  if (ci || hook) return [];
  if (!branch) return ["Git branch could not be determined; do not work from a detached HEAD."];
  if (branch === "main" || branch === "master") {
    return [`Current branch is '${branch}'. Switch to an authorized feature branch before making changes.`];
  }
  return [];
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return { ok: false, text: (result.stderr || result.error?.message || "git command failed").trim() };
  }
  return { ok: true, text: result.stdout.trim() };
}

function run() {
  const args = new Set(process.argv.slice(2));
  const ci = args.has("--ci");
  const hook = args.has("--hook");
  const errors = validatePolicyFiles(ROOT);
  const branchResult = git(["branch", "--show-current"]);
  const statusResult = git(["status", "--short"]);
  const branch = branchResult.ok ? branchResult.text : "";

  if (!branchResult.ok) errors.push(`Unable to inspect current Git branch: ${branchResult.text}`);
  if (!statusResult.ok) errors.push(`Unable to inspect Git worktree: ${statusResult.text}`);
  errors.push(...validateBranch(branch, { ci, hook }));

  const output = [];
  output.push("KIRAN DMS — AGENT PREFLIGHT (READ-ONLY)");
  output.push(`Mode: ${ci ? "CI validation" : hook ? "Claude Code SessionStart" : "local startup"}`);
  output.push(`Branch: ${branch || "UNKNOWN"}`);
  if (statusResult.ok) {
    output.push(
      statusResult.text ? `Worktree changes detected (inspect before editing):\n${statusResult.text}` : "Worktree: clean",
    );
  }
  if (errors.length) {
    output.push("PREFLIGHT: BLOCKED");
    for (const error of errors) output.push(`- ${error}`);
  } else {
    output.push("PREFLIGHT: required governance files and references are present.");
  }
  output.push("");
  output.push("MANDATORY NEXT ACTIONS:");
  output.push(
    "1. Read docs/AGENT-COMPLIANCE-PROTOCOL.md in full (this content is injected below in Claude Code SessionStart mode).",
  );
  output.push("2. Read docs/ACTIVITY.md in full, including the last 20 entries, claims, blockers, decisions and status board.");
  output.push("3. Read docs/00-README.md, SPEC.md and the source documents for the task requirements.");
  output.push("4. Preserve all existing work; check active claims; record SESSION-START and CLAIM before edits.");
  output.push("5. Do not work on main. Do not touch staging/production or real data without explicit MJ authorization.");
  output.push("This script does not create log entries, modify files, or prove that the agent understood the policy.");

  if (hook) {
    const policy = readText(ROOT, POLICY_PATH);
    if (policy) output.push("\n===== FULL MANDATORY AGENT COMPLIANCE PROTOCOL =====\n", policy);
  }

  process.stdout.write(`${output.join("\n")}\n`);
  if (errors.length && !hook) process.exitCode = 1;
  if (errors.length && hook)
    process.stderr.write("SessionStart context loaded with a preflight warning; resolve blockers before editing.\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) run();
