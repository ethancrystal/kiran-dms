/**
 * Shared set-up for the log-check cases (scripts/activity-log-check.mjs, ACTIVITY Appendix C): each
 * case is one commit in a throwaway clone whose base commit carries the WORKTREE script, rules and
 * log, so a fix is seen before it is committed. A case's entry becomes its own file in docs/log/.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Puts the next lines of a case into a second log file. */
export const NEXT_FILE = "=== next log file ===";

/** The stem of a case's first log file: its header date plus "case". Board rows cite this. */
export const caseStem = (date: string) => `${date}-case`;

// The date in a log header: matches "# 2026-10-27 04:00 PKT · ...", rejects "### L-0099 · 2026-10-27".
// Tester: https://regex101.com/?regex=%5E%23%20(%5Cd%7B4%7D-%5Cd%7B2%7D-%5Cd%7B2%7D)%20&flavor=javascript
const HEADER_DATE = /^# (\d{4}-\d{2}-\d{2}) /;

/** Copies the worktree's script, rules and whole log into the clone, for its base commit. */
export function overlayWorktree(root: string, dir: string): void {
  ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"].forEach((rel) => {
    copyFileSync(join(root, rel), join(dir, rel));
  });
  const log = join(dir, "docs", "log");
  rmSync(log, { recursive: true, force: true });
  mkdirSync(log, { recursive: true });
  readdirSync(join(root, "docs", "log")).forEach((f) => {
    copyFileSync(join(root, "docs", "log", f), join(log, f));
  });
}

/** Writes a case's lines as docs/log/{date}-case.md, then {date}-case-2.md after a NEXT_FILE, and so on. */
export function writeLogEntries(dir: string, lines: string[]): void {
  const starts = [-1, ...lines.flatMap((l, i) => (l === NEXT_FILE ? [i] : []))];
  const groups = starts.map((s, i) => lines.slice(s + 1, starts[i + 1]));
  const date = HEADER_DATE.exec(lines[0] ?? "")?.[1] ?? "2026-10-26";
  groups
    .filter((g) => g.length > 0)
    .forEach((g, i) => {
      writeFileSync(join(dir, "docs", "log", `${caseStem(date)}${i ? `-${i + 1}` : ""}.md`), g.join("\n"));
    });
}
