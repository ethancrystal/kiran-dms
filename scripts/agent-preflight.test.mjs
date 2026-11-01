import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateBranch, validatePolicyFiles } from "./agent-preflight.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kiran-agent-policy-"));
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  };
  const agentInstructions = [
    "# Kiran DMS — READ THIS FIRST",
    "Read docs/AGENT-COMPLIANCE-PROTOCOL.md and docs/ACTIVITY.md.",
    "Run pnpm agent:preflight before changes.",
  ].join("\n");
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "node scripts/agent-preflight.mjs --hook" }] }],
    },
  };
  write("AGENTS.md", agentInstructions);
  write("CLAUDE.md", agentInstructions);
  write("docs/AGENT-COMPLIANCE-PROTOCOL.md", "# Protocol\n\n## 2. Required startup sequence\n");
  write("docs/ACTIVITY.md", "# Activity\n\nAppendix A references docs/AGENT-COMPLIANCE-PROTOCOL.md\n");
  write(".claude/settings.json", JSON.stringify(settings));
  write("scripts/agent-preflight.mjs", "// present\n");
  write("scripts/agent-preflight.test.mjs", "// present\n");
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
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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
    const errors = validatePolicyFiles(f.root);
    assert.ok(errors.some((error) => error.includes("AGENTS.md does not reference")));
    assert.ok(errors.some((error) => error.includes("AGENTS.md and CLAUDE.md differ")));
  } finally {
    f.cleanup();
  }
});

test("rejects an ACTIVITY Appendix A that does not reference the protocol", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "docs/ACTIVITY.md"), "# Activity\n");
    assert.ok(validatePolicyFiles(f.root).some((error) => error.includes("Appendix A must reference")));
  } finally {
    f.cleanup();
  }
});

test("rejects a missing or invalid SessionStart hook", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, ".claude/settings.json"), JSON.stringify({ hooks: {} }));
    assert.ok(validatePolicyFiles(f.root).some((error) => error.includes("SessionStart command hook")));
  } finally {
    f.cleanup();
  }
});

test("rejects main locally but allows CI checkout and reports feature branches", () => {
  assert.ok(validateBranch("main").length > 0);
  assert.ok(validateBranch("master").length > 0);
  assert.deepEqual(validateBranch("feat/agent-governance"), []);
  assert.deepEqual(validateBranch("", { ci: true }), []);
});
