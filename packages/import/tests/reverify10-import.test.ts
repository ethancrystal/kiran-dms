// Tenth re-verification (ACTIVITY §7, L-0115) of P0-02, the Excel/CSV salon import dry-run, after
// L-0088 and L-0106 (council findings 8, 9 and 10). Written by the re-verifier-10 workflow, not the
// builder. All data is synthetic (H-03): "Test Salon NN", 0399-prefixed numbers, public locality
// names. Spreadsheets are generated in a temp dir outside the repository and deleted. Nothing
// touches a database or the network.
//
// "DEFECT CHECK" states the secure expectation: a failure is a defect in the tool. "FALSE
// POSITIVE CHECK" is an honest file that must be read correctly. "CONTROL" and "OBSERVATION"
// pass either way. Do not loosen these.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv, splitHeader } from "../src/core/csv.ts";
import { dryRun, formatReport, reportJson } from "../src/core/validate.ts";
import { readTable } from "../src/read.ts";

const PKG = resolve(import.meta.dirname, "..");
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: PKG, encoding: "utf8", env: { ...process.env, INIT_CWD: PKG } });
const verdict = (table: string[][]) => {
  const { headers, rows, firstDataRow } = splitHeader(table);
  return dryRun(headers, rows, { firstDataRow });
};
// Parse and check a CSV text; a refused file (parser error) is reported as such.
const csvOutcome = (text: string) => {
  try {
    const r = verdict(parseCsv(text));
    return { refused: false, clean: r.clean, rowsRead: r.rowsRead, errorRows: [...new Set(r.errors.map((e) => e.row))] };
  } catch (e) {
    return { refused: true, clean: false, rowsRead: 0, errorRows: [] as number[], message: (e as Error).message };
  }
};
const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "kiran-rv10-import-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};
const xlsx = async (dir: string, name: string, build: (wb: ExcelJS.Workbook) => void) => {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const p = join(dir, name);
  await wb.xlsx.writeFile(p);
  return p;
};

describe("P0-02 dry-run (re-verifier-10)", () => {
  it("CONTROL: findings 8 and 9 hold for exact repeats and never-closed quotes", () => {
    const dup = csvOutcome("Salon Name,Area,Phone,Phone\nTest Salon 01,Gulshan,0399-0000001,0399-0000002\n");
    expect(dup.clean).toBe(false);
    const open = csvOutcome('Salon Name,Area,Mobile\nTest Salon 01,"Gulshan,0399-0000001\n');
    expect(open.refused).toBe(true);
  });

  // DEFECT D1 (finding 9 reopened; L-0106 says swallowed rows no longer report CLEAN). A quote at
  // the start of a field opens a quoted field that runs to the next lone quote anywhere in the
  // file (here the inch mark in row 6), and text after a closing quote is kept (RFC 4180 refuses
  // it). Rows 4 and 5, each with an error, vanish into row 3's Notes cell; the run says CLEAN with
  // 3 of 6 rows, and later rows get the wrong row number. Reachable from a hand-edited CSV.
  it("DEFECT CHECK: a quote closed by a stray quote on a later line swallows rows and the run says CLEAN", () => {
    const head = [
      "Salon Name,Area,Mobile,Notes",
      "Test Salon 01,Gulshan,0399-0000001,ok",
      'Test Salon 02,Clifton,0399-0000002,"Corner shop',
      "Test Salon 03,Saddar,0399-000000,bad phone",
      "Test Salon 04,,0399-0000004,no area",
      'Test Salon 05,Gulshan,0399-0000005,has 12" mirror',
    ];
    const a2 = csvOutcome([...head, "Test Salon 07,Saddar,0399-0000007,ok", ""].join("\n"));
    const bad7 = csvOutcome([...head, "Test Salon 07,,0399-00007,bad", ""].join("\n"));
    console.log("rv10 P0-02 D1:", JSON.stringify({ a2, bad7 }));
    const res = {
      noWrongClean: a2.refused || (!a2.clean && a2.rowsRead === 6),
      row7Named: bad7.refused || bad7.errorRows.includes(7),
    };
    expect(res).toEqual({ noWrongClean: true, row7Named: true });
  });

  // DEFECT D2 (finding 8 reopened). keyOf turns an invisible format character (Unicode Cf) in the
  // middle of a heading into a word break, so a second heading that renders as "Phone" or "Mobile"
  // is neither a duplicate nor a phone column: it is ignored ("column D"), its bad number and its
  // repeated phone are never checked, and the run says CLEAN. ZWNJ is common in pasted Urdu text.
  // (A Cyrillic look-alike letter also passes; the project treats look-alikes as a known limit, so
  // it is not part of this check.)
  it("DEFECT CHECK: a second phone heading with an invisible character in it is dropped unchecked and the run says CLEAN", () => {
    const sheet = (h1: string, h2: string) =>
      `Salon Name,Area,${h1},${h2}\nTest Salon 01,Gulshan,0399-0000001,0399-000\nTest Salon 02,Clifton,0399-0000002,0399-0000001\n`;
    const res = {
      zwsp: csvOutcome(sheet("Phone", "Ph​one")).clean,
      softHyphen: csvOutcome(sheet("Phone", "Ph­one")).clean,
      zwnj: csvOutcome(sheet("Mobile", "Mob‌ile")).clean,
    };
    console.log("rv10 P0-02 D2 clean:", JSON.stringify(res));
    expect(res).toEqual({ zwsp: false, softHyphen: false, zwnj: false });
  });

  // DEFECT D3 (H-03, H-25; runbook: the report never prints salon names, and names only the sheet
  // it read). The CLI prints every hidden sheet's name ("hidden sheets skipped: ...") and, when
  // --sheet names a missing sheet, every sheet name in the workbook. A ledger with one tab per salon
  // (khata) puts salon names on the console. The JSON report is not affected.
  it("DEFECT CHECK (H-03): the CLI prints skipped hidden sheet names and, for a wrong --sheet, every sheet name", async () => {
    await withDir(async (dir) => {
      const p = await xlsx(dir, "khata.xlsx", (wb) => {
        wb.addWorksheet("Test Salon 01 khata", { state: "hidden" }).addRow(["x"]);
        wb.addWorksheet("Test Salon 02 khata", { state: "hidden" }).addRow(["x"]);
        wb.addWorksheet("Test Salon 03 khata", { state: "veryHidden" }).addRow(["x"]);
        const ws = wb.addWorksheet("List");
        ws.addRow(["Salon Name", "Area", "Mobile"]);
        ws.addRow(["Test Salon 09", "Gulshan", "0399-0000009"]);
      });
      const plain = cli(p);
      const wrong = cli(p, "--sheet", "Nope");
      const leak = (r: ReturnType<typeof cli>) => /Test Salon 0[1-3] khata/.test(r.stdout + r.stderr);
      console.log("rv10 P0-02 D3 (status plain, wrong):", plain.status, wrong.status, "| first lines:",
        JSON.stringify(plain.stdout.split("\n")[0]), JSON.stringify(wrong.stderr.split("\n")[0]));
      expect({ plain: leak(plain), wrong: leak(wrong) }).toEqual({ plain: false, wrong: false });
    });
  });

  // DEFECT D4 (H-03, H-25; L-0098 / L-0106 treat "a row dropped unchecked while the run says CLEAN"
  // as a defect). On a sheet with no header row, any row among the first 20 whose cells match two
  // fields by prefix ("Salon ..." to name, "Block ..." to area) becomes the header: it and every row
  // above it are dropped without a message, the phone column is left unmapped (no phone checks),
  // and a name made only of heading words is printed in the mapping, text and JSON.
  it("DEFECT CHECK (H-03): a data row matching two fields by prefix is taken as the header, dropped silently and printed", () => {
    const r = verdict(parseCsv("Salon Colour,Block 13,0399-0000001\nTest Salon 02,Clifton,0399-0000002\nTest Salon 03,Saddar,0399-0000003\n"));
    const res = {
      droppedButClean: r.clean && r.rowsRead < 3,
      namePrinted: /Salon Colour/.test(formatReport(r) + reportJson(r)),
    };
    console.log("rv10 P0-02 D4:", JSON.stringify({ clean: r.clean, rowsRead: r.rowsRead, mapping: r.mapping, ...res }));
    expect(res).toEqual({ droppedButClean: false, namePrinted: false });
  });

  // FALSE POSITIVE FP1 (fails closed). A calculated formula whose saved result is the empty string
  // (=IF(paid,"",due), often dragged down a column) is read as "a formula with no saved result" and
  // refused; recalculating cannot fix it. exceljs drops an empty cached value, so a fix has to read
  // the raw cell. The file here is written by exceljs (as <v></v>), not by Excel itself.
  it("FALSE POSITIVE CHECK: a formula whose saved result is an empty string is refused as having no result", async () => {
    await withDir(async (dir) => {
      const p = await xlsx(dir, "blank-formula.xlsx", (wb) => {
        const ws = wb.addWorksheet("Salons");
        ws.addRow(["Salon Name", "Area", "Mobile", "Balance"]);
        ws.addRow(["Test Salon 01", "Gulshan", "0399-0000001", { formula: 'IF(1=0,5,"")', result: "" }]);
      });
      const r = verdict(await readTable(p));
      console.log("rv10 P0-02 FP1:", JSON.stringify({ clean: r.clean, errors: r.errors.map((e) => [e.row, e.field]) }));
      expect(r.clean).toBe(true);
    });
  });

  // OBSERVATION O1. In a file that uses CR alone for line breaks (accepted as a row break), the
  // never-closed-quote error always names line 1, because the counter counts only LF. The file is
  // still refused; only the message is affected.
  it("OBSERVATION: the unterminated-quote message names line 1 in a CR-only file", () => {
    const r = csvOutcome(["Salon Name,Area,Mobile", "Test Salon 01,Gulshan,0399-0000001", 'Test Salon 02,"Clifton,0399-0000002'].join("\r"));
    console.log("rv10 P0-02 O1:", JSON.stringify(r));
    expect(r.refused).toBe(true);
  });
});
