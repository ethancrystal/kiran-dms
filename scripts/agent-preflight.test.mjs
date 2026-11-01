import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  appendixA,
  buildHookContext,
  HOOK_ARGS,
  HOOK_COMMAND,
  HOOK_MATCHER,
  HOOK_OUTPUT_LIMIT,
  validateBranch,
  validatePolicyFiles,
} from "./agent-preflight.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO, "scripts", "agent-preflight.mjs");

const goodHook = () => ({
  hooks: {
    SessionStart: [
      { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: HOOK_COMMAND, args: [...HOOK_ARGS], timeout: 30 }] },
    ],
  },
});

const minimalPolicy =
  "# Protocol\n\n## 2. Required startup sequence\n\nRule.\n\n## 11. Untrusted content and prompt-injection defence\n\nRule.\n";

/** A minimal, fully installed policy set in a temp directory. */
function fixture({ policy = minimalPolicy, realScript = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kiran-agent-policy-"));
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const instructions = [
    "# Kiran DMS — READ THIS FIRST",
    "Read docs/AGENT-COMPLIANCE-PROTOCOL.md and docs/ACTIVITY.md.",
    "Run pnpm agent:preflight before changes.",
    "",
  ].join("\n");
  write("AGENTS.md", instructions);
  write("CLAUDE.md", instructions);
  write("docs/AGENT-COMPLIANCE-PROTOCOL.md", policy);
  write(
    "docs/ACTIVITY.md",
    "# Activity\n\n## 16. Activity log\n\n## Appendix A — Text\n\nRead docs/AGENT-COMPLIANCE-PROTOCOL.md.\n\n## Appendix B — Other\n",
  );
  write(".claude/settings.json", JSON.stringify(goodHook()));
  write(".gitignore", "node_modules/\n.claude/settings.local.json\n.claude/worktrees/\n");
  write("scripts/agent-preflight.test.mjs", "// present\n");
  if (realScript) copyFileSync(SCRIPT, join(root, "scripts", "agent-preflight.mjs"));
  else write("scripts/agent-preflight.mjs", "// present\n");
  write(".github/workflows/agent-compliance.yml", "name: agent-compliance\n");
  write(
    "package.json",
    JSON.stringify({
      scripts: {
        "agent:preflight": "node scripts/agent-preflight.mjs",
        "agent:preflight:test": "node --test scripts/agent-preflight.test.mjs",
      },
    }),
  );
  return { root, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Same, as a git repository on `branch` with everything committed, running the real script. */
function gitFixture(branch, options = {}) {
  const f = fixture({ ...options, realScript: true });
  const g = (...args) => {
    const r = spawnSync("git", args, { cwd: f.root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  g("init", "-q", "-b", branch);
  g("-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "fixture");
  const runScript = (...args) =>
    spawnSync(process.execPath, [join(f.root, "scripts", "agent-preflight.mjs"), ...args], {
      cwd: f.root,
      encoding: "utf8",
    });
  return { ...f, g, runScript };
}

test("accepts a fully installed, synchronized policy set", () => {
  const f = fixture();
  try {
    assert.deepEqual(validatePolicyFiles(f.root), []);
  } finally {
    f.cleanup();
  }
});

test("rejects missing policy files and missing root instructions", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "AGENTS.md"), "# Missing references\n");
    rmSync(join(f.root, "docs/AGENT-COMPLIANCE-PROTOCOL.md"));
    const errors = validatePolicyFiles(f.root);
    assert.ok(errors.some((e) => e.includes("AGENTS.md does not reference")));
    assert.ok(errors.some((e) => e.includes("AGENTS.md and CLAUDE.md differ")));
    assert.ok(errors.some((e) => e.includes("Required file is missing: docs/AGENT-COMPLIANCE-PROTOCOL.md")));
  } finally {
    f.cleanup();
  }
});

test("rejects an ACTIVITY Appendix A that does not reference the protocol, even if another section does", () => {
  const f = fixture();
  try {
    f.write(
      "docs/ACTIVITY.md",
      "# Activity\n\n## 16. Log\n\ndocs/AGENT-COMPLIANCE-PROTOCOL.md\n\n## Appendix A — Text\n\nNothing.\n\n## Appendix B\n\ndocs/AGENT-COMPLIANCE-PROTOCOL.md\n",
    );
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes("Appendix A must reference")));
    f.write("docs/ACTIVITY.md", "# Activity\n");
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes('has no "## Appendix A" section')));
  } finally {
    f.cleanup();
  }
});

test("rejects a missing, invalid, relative, shell-form or filtered SessionStart hook", () => {
  const f = fixture();
  const hookError = () => validatePolicyFiles(f.root).some((e) => e.includes("SessionStart command hook"));
  try {
    f.write(".claude/settings.json", JSON.stringify({ hooks: {} }));
    assert.ok(hookError(), "no hook");
    // The original kit's form: relative path through a shell; breaks outside the repository root.
    f.write(
      ".claude/settings.json",
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node scripts/agent-preflight.mjs --hook" }] }] },
      }),
    );
    assert.ok(hookError(), "relative shell-form hook");
    for (const matcher of ["startup", "startup|resume|clear|compact", undefined]) {
      const other = goodHook();
      other.hooks.SessionStart[0].matcher = matcher;
      f.write(".claude/settings.json", JSON.stringify(other));
      assert.ok(
        hookError(),
        `matcher ${matcher}: must be exactly ${HOOK_MATCHER} (no reload on resume, yes after clear and compaction)`,
      );
    }
    const wrongArgs = goodHook();
    wrongArgs.hooks.SessionStart[0].hooks[0].args = ["scripts/agent-preflight.mjs", "--hook"];
    f.write(".claude/settings.json", JSON.stringify(wrongArgs));
    assert.ok(hookError(), "args without ${CLAUDE_PROJECT_DIR}");
    f.write(".claude/settings.json", "not json");
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes("is not valid JSON")));
    rmSync(join(f.root, ".claude/settings.json"));
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes("Required file is missing: .claude/settings.json")));
  } finally {
    f.cleanup();
  }
});

test("rejects a protocol that has lost its startup or prompt-injection section", () => {
  const f = fixture();
  try {
    f.write("docs/AGENT-COMPLIANCE-PROTOCOL.md", "# Protocol\n\n## 2. Required startup sequence\n");
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes("missing its untrusted-content and prompt-injection section")));
    f.write("docs/AGENT-COMPLIANCE-PROTOCOL.md", "# Protocol\n\n## 11. Untrusted content and prompt-injection defence\n");
    assert.ok(validatePolicyFiles(f.root).some((e) => e.includes("missing its mandatory startup sequence")));
  } finally {
    f.cleanup();
  }
});

test("rejects a .gitignore that would let local Claude Code state be committed", () => {
  const f = fixture();
  try {
    f.write(".gitignore", "node_modules/\n.claude/settings.local.json\n");
    const errors = validatePolicyFiles(f.root);
    assert.ok(errors.some((e) => e.includes(".gitignore must contain the line .claude/worktrees/")));
    assert.ok(!errors.some((e) => e.includes(".claude/settings.local.json")));
  } finally {
    f.cleanup();
  }
});

test("rejects main locally but allows CI checkout and reports feature branches", () => {
  assert.ok(validateBranch("main").length > 0);
  assert.ok(validateBranch("master").length > 0);
  assert.ok(validateBranch("").length > 0, "detached HEAD locally");
  assert.deepEqual(validateBranch("feat/agent-governance"), []);
  assert.deepEqual(validateBranch("", { ci: true }), []);
  assert.deepEqual(validateBranch("main", { ci: true }), []);
});

test("appendixA cuts at the next section", () => {
  assert.equal(appendixA("## Appendix A — T\na\n## Appendix B\nb"), "## Appendix A — T\na");
  assert.equal(appendixA("## Appendix B\nb"), null);
});

test("the real hook output is short and pastes none of the protocol or CLAUDE.md", () => {
  const { text } = buildHookContext(REPO);
  assert.ok(text.length <= HOOK_OUTPUT_LIMIT, `hook output is ${text.length} characters`);
  const protocol = readFileSync(join(REPO, "docs/AGENT-COMPLIANCE-PROTOCOL.md"), "utf8");
  const claudeMd = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  const sentences = (s) => s.split(/\n+/).filter((line) => line.length > 60);
  for (const line of [...sentences(protocol), ...sentences(claudeMd)]) {
    assert.ok(!text.includes(line), `hook output repeats a line from the protocol or CLAUDE.md: ${line.slice(0, 50)}`);
  }
});

test("CLI --hook: exit 0, short even with a dirty worktree, and still warns when broken", () => {
  const f = gitFixture("feat/x");
  try {
    for (let i = 0; i < 40; i++) f.write(`scratch-${i}.txt`, "x\n");
    let r = f.runScript("--hook");
    assert.equal(r.status, 0);
    assert.ok(r.stdout.length <= HOOK_OUTPUT_LIMIT, `hook output is ${r.stdout.length} characters`);
    assert.match(r.stdout, /Worktree: 40 change\(s\)/);
    assert.match(r.stdout, /and 32 more/, "long worktree listings are cut");
    assert.match(r.stdout, /PREFLIGHT OK/);
    rmSync(join(f.root, "AGENTS.md"));
    r = f.runScript("--hook");
    assert.equal(r.status, 0, "a failing SessionStart hook would hide the context");
    assert.match(r.stdout, /PREFLIGHT BLOCKED/);
    assert.match(r.stdout, /Required file is missing: AGENTS\.md/);
  } finally {
    f.cleanup();
  }
});

test("CLI local and --ci modes: exit codes on main and on a feature branch", () => {
  const onMain = gitFixture("main");
  const onFeature = gitFixture("feat/x");
  try {
    assert.equal(onMain.runScript().status, 1, "local main must fail");
    assert.match(onMain.runScript().stdout, /Current branch is 'main'/);
    assert.equal(onMain.runScript("--ci").status, 0, "CI does not check the branch");
    assert.match(onMain.runScript("--hook").stdout, /Current branch is 'main'/, "the hook warns on main");
    assert.equal(onFeature.runScript().status, 0);
    rmSync(join(onFeature.root, ".gitignore"));
    assert.equal(onFeature.runScript().status, 1);
    assert.equal(onFeature.runScript("--ci").status, 1, "file checks still apply in CI");
  } finally {
    onMain.cleanup();
    onFeature.cleanup();
  }
});

test("CLI is read-only: no file or git state changes in any mode", () => {
  const f = gitFixture("feat/x");
  try {
    f.write("untracked-user-work.txt", "keep me\n");
    f.write("AGENTS.md", `${readFileSync(join(f.root, "AGENTS.md"), "utf8")}user edit\n`);
    const snapshot = () => [f.g("status", "--porcelain"), f.g("rev-parse", "HEAD"), f.g("stash", "list")].join("|");
    const before = snapshot();
    const user = readFileSync(join(f.root, "untracked-user-work.txt"), "utf8");
    for (const mode of [[], ["--ci"], ["--hook"]]) f.runScript(...mode);
    assert.equal(snapshot(), before);
    assert.equal(readFileSync(join(f.root, "untracked-user-work.txt"), "utf8"), user);
  } finally {
    f.cleanup();
  }
});
