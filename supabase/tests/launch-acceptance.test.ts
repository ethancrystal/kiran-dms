/**
 * The launch acceptance index (P1-12). Every launch security criterion (doc 06 section 10, items 1 to 8;
 * doc 07 section 5, items 1 to 6) is mapped to named evidence in helpers/launch-acceptance.ts, and
 * docs/runbooks/launch-security-acceptance.md shows the same mapping to a human. This file fails when a
 * reference is broken, so nothing is claimed that no check proves. It reads files only: no database rows.
 *
 * - a `test` reference must be a live test (not skipped, not todo, not expected to fail);
 * - a `defect` reference must be the `it.fails` check of an open defect, and fails once it is fixed;
 * - a `blocked` entry is reported below as todo (not run), never as passing, and the set of blocked
 *   criteria is pinned, so unblocking or newly blocking one is a deliberate edit to this file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTANCE, ADDITIONAL, checkEvidence, type Entry, REPO_ROOT, type Status, statusOf } from "./helpers/launch-acceptance";

const CRITERIA = [
  "06.10.1",
  "06.10.2",
  "06.10.3",
  "06.10.4",
  "06.10.5",
  "06.10.6",
  "06.10.7",
  "06.10.8",
  "07.5.1",
  "07.5.2",
  "07.5.3",
  "07.5.4",
  "07.5.5",
  "07.5.6",
];
const ADDITIONAL_IDS = ["ADD.1", "ADD.2"];

// The pinned gaps. Editing either list is a deliberate act: the criterion is unblocked or newly blocked.
const EXPECTED_BLOCKED = [
  "06.10.4 | P1-05",
  "06.10.5 | audit mirror (no task id yet, MJ assigns)",
  "06.10.6 | P1-08",
  "06.10.7 | P1-12 PR C",
  "06.10.8 | P1-12 PR A",
  "07.5.2 | P1-05",
  "07.5.3 | P1-05",
  "07.5.4 | P1-05",
  "07.5.5 | P1-05",
  "07.5.6 | P1-05",
];
const EXPECTED_DEFECTS = ["06.10.3"];

const RUNBOOK = join(REPO_ROOT, "docs/runbooks/launch-security-acceptance.md");
const SOURCE_DOC: Record<string, string> = {
  "06": "docs/06-security-plan.md",
  "07": "docs/07-supplier-confidentiality.md",
  AD: "docs/ACTIVITY.md",
};
const all = [...ACCEPTANCE, ...ADDITIONAL];

const ID_PREFIXES = ["06.10.", "07.5.", "ADD."];
const PREFIX_LENGTH = 2;

// A table row of the runbook that starts with a criterion id: "| 06.10.3 | ..." yes; the header and "| --- |" no.
const isIdRow = (line: string) => line.startsWith("|") && ID_PREFIXES.some((p) => line.slice(1).trim().startsWith(p));
const normalise = (s: string) =>
  s
    .replaceAll("*", "")
    .replaceAll("`", "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .split(" ")
    .filter(Boolean)
    .join(" ");
const runbook = () => readFileSync(RUNBOOK, "utf8").replaceAll("\r\n", "\n");
const rows = () =>
  runbook()
    .split("\n")
    .map((l) => l.trim())
    .filter(isIdRow)
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
const sectionOf = (id: string) =>
  runbook()
    .split("\n### ")
    .find((s) => s.startsWith(`${id} `)) ?? "";
const sourceDoc = (id: string) => readFileSync(join(REPO_ROOT, SOURCE_DOC[id.slice(0, PREFIX_LENGTH)]), "utf8");

describe("the acceptance index", () => {
  it("lists criteria 06.10.1 to 06.10.8 and 07.5.1 to 07.5.6, in order, once each", () => {
    expect(ACCEPTANCE.map((e) => e.criterion)).toEqual(CRITERIA);
    expect(ADDITIONAL.map((e) => e.criterion)).toEqual(ADDITIONAL_IDS);
  });

  it("every reference resolves: tests exist and are live, CI jobs exist, manual files exist, defects are open", () => {
    const broken = all.flatMap((e) => checkEvidence(e, REPO_ROOT));
    expect(broken).toEqual([]);
  });

  it("every criterion carries evidence, and every entry names a test, a job, a file, a task or a defect", () => {
    all.forEach((e) => {
      expect(e.evidence.length, e.criterion).toBeGreaterThan(0);
      e.evidence.forEach((ev) => {
        expect(ev.ref.trim().length, `${e.criterion} ${ev.kind}`).toBeGreaterThan(0);
      });
    });
  });
});

describe("the guard itself (planted references in a throwaway tree)", () => {
  const plant = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "kiran-accept-"));
    Object.entries(files).forEach(([rel, body]) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    });
    return root;
  };
  const SPEC = [
    'describe("planted", () => {',
    '  it("planted live title", () => {});',
    '  it.skip("planted skipped title", () => {});',
    '  it.todo("planted todo title");',
    '  it.fails("planted defect title", () => {});',
    '  // it("planted commented title", () => {});',
    "});",
  ].join("\n");
  const CI = [
    "name: ci",
    "jobs:",
    "  alpha:",
    "    steps:",
    "      - run: node scripts/planted-scan.mjs",
    "  beta:",
    "    steps:",
    "      - run: echo hi",
  ].join("\n");
  const verdict = (evidence: Entry["evidence"], root: string) => checkEvidence({ criterion: "X.1", evidence }, root);

  it("accepts references that are valid", () => {
    const root = plant({ "t/a.test.ts": SPEC, ".github/workflows/ci.yml": CI, "docs/run.md": "# run" });
    try {
      const good = [
        { kind: "test", ref: "t/a.test.ts::planted live title" },
        { kind: "defect", ref: "t/a.test.ts::planted defect title" },
        { kind: "ci", ref: "alpha" },
        { kind: "ci", ref: "alpha::scripts/planted-scan.mjs" },
        { kind: "manual", ref: "docs/run.md" },
        { kind: "blocked", ref: "P1-99" },
      ] as const;
      expect(verdict([...good], root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns one message for each kind of broken reference", () => {
    const root = plant({ "t/a.test.ts": SPEC, ".github/workflows/ci.yml": CI });
    try {
      const bad: Array<[Entry["evidence"][number], string]> = [
        [{ kind: "test", ref: "t/missing.test.ts::planted live title" }, "missing.test.ts"],
        [{ kind: "test", ref: "t/a.test.ts::a title nobody wrote" }, "a title nobody wrote"],
        [{ kind: "test", ref: "t/a.test.ts::planted skipped title" }, "skipped title"],
        [{ kind: "test", ref: "t/a.test.ts::planted todo title" }, "todo title"],
        [{ kind: "test", ref: "t/a.test.ts::planted commented title" }, "commented title"],
        [{ kind: "test", ref: "t/a.test.ts::planted defect title" }, "defect title"],
        [{ kind: "test", ref: "t/a.test.ts" }, "path::title"],
        [{ kind: "defect", ref: "t/a.test.ts::planted live title" }, "it.fails"],
        [{ kind: "ci", ref: "gamma" }, "gamma"],
        [{ kind: "ci", ref: "beta::scripts/planted-scan.mjs" }, "planted-scan"],
        [{ kind: "manual", ref: "docs/nowhere.md" }, "nowhere.md"],
        [{ kind: "blocked", ref: "  " }, "blocked"],
        [{ kind: "nonsense" as never, ref: "x" }, "nonsense"],
      ];
      bad.forEach(([ev, fragment]) => {
        const out = verdict([ev], root);
        expect(out.length, JSON.stringify(ev)).toBe(1);
        expect(out[0]).toContain(fragment);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a criterion with no evidence fails", () => {
    expect(verdict([], tmpdir()).length).toBe(1);
  });

  it("blocked and defect entries never make a criterion read as met", () => {
    const t = { kind: "test", ref: "x::y" } as const;
    const b = { kind: "blocked", ref: "P1-99" } as const;
    const d = { kind: "defect", ref: "x::z" } as const;
    const status = (evidence: Entry["evidence"]): Status => statusOf({ criterion: "X.1", evidence });
    expect(status([t])).toBe("met");
    expect(status([t, b])).toBe("partial");
    expect(status([b])).toBe("blocked");
    expect(status([t, d])).toBe("defect");
    expect(status([t, b, d])).toBe("defect");
    expect(status([])).toBe("blocked");
  });
});

describe("blocked and defective criteria are pinned", () => {
  const blocked = all.flatMap((e) => e.evidence.filter((v) => v.kind === "blocked").map((v) => `${e.criterion} | ${v.ref}`));
  const defects = all.filter((e) => e.evidence.some((v) => v.kind === "defect")).map((e) => e.criterion);

  it("the blocked set equals the expected list", () => {
    expect([...blocked].sort()).toEqual([...EXPECTED_BLOCKED].sort());
  });

  it("the criteria with an open defect equal the expected list", () => {
    expect(defects).toEqual(EXPECTED_DEFECTS);
  });

  it("no criterion with a blocked or defect entry has status met", () => {
    all
      .filter((e) => e.evidence.some((v) => v.kind === "blocked" || v.kind === "defect"))
      .forEach((e) => {
        expect(statusOf(e), e.criterion).not.toBe("met");
      });
  });

  // Not run, not passed: the reporter lists these as todo.
  all.forEach((e) => {
    e.evidence.forEach((v) => {
      if (v.kind === "blocked") it.todo(`${e.criterion} BLOCKED on ${v.ref}: not proven`);
      if (v.kind === "defect") it.todo(`${e.criterion} DEFECT open: ${v.ref}`);
    });
  });
});

describe("the runbook matches the index", () => {
  it("its table lists exactly the criteria of the index, in order", () => {
    expect(rows().map((r) => r[0])).toEqual([...CRITERIA, ...ADDITIONAL_IDS]);
  });

  it("each criterion's wording is quoted verbatim from the document that sets it", () => {
    rows().forEach((r) => {
      expect(normalise(sourceDoc(r[0])), r[0]).toContain(normalise(r[1]));
    });
  });

  it("each criterion's status in the table is the one computed from its evidence", () => {
    const got = Object.fromEntries(rows().map((r) => [r[0], r[2]]));
    const want = Object.fromEntries(all.map((e) => [e.criterion, statusOf(e)]));
    expect(got).toEqual(want);
  });

  it("each criterion's section lists every reference of its evidence", () => {
    all.forEach((e) => {
      const section = sectionOf(e.criterion);
      expect(section.length, `section for ${e.criterion}`).toBeGreaterThan(0);
      e.evidence.forEach((v) => {
        expect(section, `${e.criterion} ${v.ref}`).toContain(v.ref);
      });
    });
  });
});
