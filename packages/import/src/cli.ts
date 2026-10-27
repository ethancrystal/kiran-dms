#!/usr/bin/env node
// Kiran salon import, DRY RUN (P0-02, SAL-10). Reads an .xlsx or .csv, checks every row
// against the salon fields of doc 04 and prints a masked report. It writes nothing to any
// database. Exit code: 0 clean, 1 not clean, 2 usage or read failure.
//
//   pnpm -C packages/import dry-run <file> [--sheet NAME] [--mapping map.json]
//        [--areas areas.txt] [--json] [--max-issues N]
//
// The owner's real file must stay outside the repository (H-03); see
// docs/runbooks/excel-import-dry-run.md.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { splitHeader } from "./core/csv.ts";
import { dryRun, formatReport, reportJson } from "./core/validate.ts";
import { readTable, type ReadInfo } from "./read.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REPORT_DIR = join(REPO_ROOT, "import-reports");   // git-ignored

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error("usage: pnpm -C packages/import dry-run <file.xlsx|file.csv> [--sheet NAME] [--mapping map.json] [--areas areas.txt] [--json] [--max-issues N]");
  process.exit(2);
}

const inside = (root: string, p: string) => { const r = relative(root, p); return r !== "" && !r.startsWith("..") && !isAbsolute(r); };

async function main() {
  const args = process.argv.slice(2);
  let file: string | undefined, sheet: string | undefined, mappingPath: string | undefined, areasPath: string | undefined;
  let json = false, maxIssues = 200;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i] ?? usage(`${a} needs a value`);
    if (a === "--sheet") sheet = next();
    else if (a === "--mapping") mappingPath = next();
    else if (a === "--areas") areasPath = next();
    else if (a === "--json") json = true;
    else if (a === "--max-issues") { maxIssues = Number(next()); if (!Number.isInteger(maxIssues) || maxIssues < 1) usage("--max-issues must be a positive whole number"); }
    else if (a === "--help" || a === "-h") usage();
    else if (a.startsWith("--")) usage(`unknown option ${a}`);
    else if (file) usage("give one file");
    else file = a;
  }
  if (!file) usage("no file given");
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);

  // H-03: real salon data never enters the repository. Warn loudly; the run still proceeds
  // so a synthetic fixture under tests/ can be checked.
  if (inside(REPO_ROOT, path) && !inside(join(REPO_ROOT, "packages/import/tests"), path)) {
    console.error("WARNING: this file is inside the repository. Real salon data must never be committed (H-03): move it outside the repo folder.\n");
  }

  let explicit: Record<string, string> = {};
  if (mappingPath) {
    try { explicit = JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), mappingPath), "utf8")); }
    catch (e) { usage(`cannot read the mapping file: ${(e as Error).message}`); }
    if (typeof explicit !== "object" || explicit === null || Array.isArray(explicit) || Object.values(explicit).some((v) => typeof v !== "string")) usage('the mapping file must be a JSON object like {"name": "Salon Name", "area": "Area"}');
  }
  let knownAreas: string[] | undefined;
  if (areasPath) {
    try { knownAreas = (await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), areasPath), "utf8")).split(/\r?\n/).map((l) => l.split(",")[0].trim()).filter(Boolean); }
    catch (e) { usage(`cannot read the area list: ${(e as Error).message}`); }
  }

  let table: string[][];
  const info: ReadInfo = {};
  try { table = await readTable(path, sheet, info); }
  catch (e) { console.error(`error: cannot read ${basename(path)}: ${(e as Error).message}`); process.exit(2); }

  const { headers, rows, firstDataRow } = splitHeader(table, explicit);
  const report = dryRun(headers, rows, { mapping: explicit, knownAreas, firstDataRow });
  if (info.sheet !== undefined) {
    // Which sheet was checked, so a hidden or wrong sheet is never mistaken for the real one (L-0085 D3).
    console.log(`Sheet read: "${info.sheet}"${info.sheetHidden ? " (HIDDEN sheet, chosen with --sheet)" : ""}` +
      (info.hiddenSkipped?.length ? `; hidden sheets skipped: ${info.hiddenSkipped.map((n) => `"${n}"`).join(", ")}` : "") + "\n");
  }
  console.log(formatReport(report, { maxIssues }));

  if (json) {
    await mkdir(REPORT_DIR, { recursive: true });
    const out = join(REPORT_DIR, `dry-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(out, reportJson(report) + "\n", "utf8");
    console.log(`\nJSON report: ${relative(REPO_ROOT, out)} (git-ignored; masked; never commit it)`);
  }
  process.exit(report.clean ? 0 : 1);
}

main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(2); });
