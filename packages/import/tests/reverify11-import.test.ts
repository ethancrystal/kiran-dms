// Eleventh re-verification (ACTIVITY §7) of P0-02, the Excel/CSV salon import dry-run. Written by
// the re-verifier-11 workflow, not the builder; first recorded in an unmerged entry (local commit
// a2b1105, there numbered L-0127) and carried onto main by ACTIVITY L-0226. All data is synthetic
// (H-03): "Test Salon NN", 0399-prefixed numbers, public locality names. Spreadsheets are generated
// in a temp dir outside the repository and deleted. Nothing touches a database or the network.
//
// Test kinds (MJ decision, ACTIVITY L-0225):
// - "CONTROL" and "OBSERVATION" pass either way.
// - "REPRODUCTION" is an ordinary test that proves the scenario really ran (the file was read, the
//   CLI executed). If it fails, the setup is broken; it never counts as a reproduced defect.
// - "DEFECT CHECK" states the secure expectation with one decisive assertion. While the defect
//   exists it is marked `it.fails` (an expected failure, so CI stays green). When a builder fixes
//   the defect, the check passes, `it.fails` reports that as a failure, and the builder must change
//   `it.fails` to `it` in the same pull request as the fix.
// Do not loosen, skip or delete any of these (H-23).
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv, splitHeader } from "../src/core/csv.ts";
import { dryRun } from "../src/core/validate.ts";
import { readTable } from "../src/read.ts";

// The parts of jszip this file uses. jszip is exceljs's own dependency (not declared here), so it
// is loaded through exceljs's resolver.
interface ZipEntry {
  async(type: "string"): Promise<string>;
}
interface Zip {
  file(path: string): ZipEntry | null;
  file(path: string, data: string): Zip;
  generateAsync(options: { type: "nodebuffer" }): Promise<Buffer>;
}
interface JSZipStatic {
  loadAsync(data: Buffer): Promise<Zip>;
}
const requireFromExceljs = createRequire(createRequire(import.meta.url).resolve("exceljs"));
const JSZip = requireFromExceljs("jszip") as JSZipStatic;

// Lines of CLI output kept in the log.
const MAX_LOGGED_LINES = 2;
// The byte-order mark of a UTF-16LE text file (FF FE), as Excel's "Unicode Text" export writes it.
const UTF16LE_BOM_FIRST = 255;
const UTF16LE_BOM_SECOND = 254;
const UTF16LE_BOM = [UTF16LE_BOM_FIRST, UTF16LE_BOM_SECOND];
const ZERO_WIDTH_SPACE = "​";
// A name made of two zero-width spaces (a name must be 2 to 120 characters).
const TWO = 2;
// Balances of the two synthetic salons in the duplicate-cell workbook.
const BALANCE_SALON_01 = 100;
const BALANCE_SALON_02 = 200;

// A synthetic salon name 01 or 02: matches "Worksheet name Test Salon 01 / Gulshan", rejects "Sheet 2 of 3".
// Tester: https://regex101.com/?regex=Test%20Salon%200%5B12%5D&flags=&flavor=javascript&testString=error%3A%20Worksheet%20name%20Test%20Salon%2001%20%2F%20Gulshan%0ASheet%202%20of%203
const SALON_NAME = /Test Salon 0[12]/;
// The synthetic number 0399 000 0001 in any grouping: matches 'Sheet read: "Shop 0399 000 0001"',
// rejects "Sheet read: sheet 1 of 1".
// Tester: https://regex101.com/?regex=399%5CD%7B0%2C3%7D000%5CD%7B0%2C3%7D0001&flags=&flavor=javascript&testString=Sheet%20read%3A%20%22Shop%200399%20000%200001%22%0ASheet%20read%3A%20sheet%201%20of%201
const FULL_PHONE = /399\D{0,3}000\D{0,3}0001/;
// The XML element of cell D3: matches '<c r="D3" s="1"><v>200</v></c>', rejects '<c r="D4"><v>200</v></c>'.
// Tester: https://regex101.com/?regex=%3Cc%20r%3D%22D3%22%5B%5E%3E%5D*%3E%5B%5Cs%5CS%5D*%3F%3C%5C%2Fc%3E&flags=&flavor=javascript&testString=%3Cc%20r%3D%22D3%22%20s%3D%221%22%3E%3Cv%3E200%3C%2Fv%3E%3C%2Fc%3E%0A%3Cc%20r%3D%22D4%22%3E%3Cv%3E200%3C%2Fv%3E%3C%2Fc%3E
const CELL_D3 = /<c r="D3"[^>]*>[\s\S]*?<\/c>/;
// A message naming the encoding: matches "cannot read: UTF-16 text", rejects "no field for name".
// Tester: https://regex101.com/?regex=utf-%3F16%7Cunicode&flags=i&flavor=javascript&testString=cannot%20read%3A%20UTF-16%20text%0Ano%20field%20for%20name
const NAMES_UTF16 = /utf-?16|unicode/i;

const PKG = resolve(import.meta.dirname, "..");
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: PKG, encoding: "utf8", env: { ...process.env, INIT_CWD: PKG } });
const verdict = (table: string[][]) => {
  const { headers, rows, firstDataRow } = splitHeader(table);
  return dryRun(headers, rows, { firstDataRow });
};
type Outcome = { refused: boolean; clean: boolean; rowsRead: number; errorRows: number[]; message?: string };
const csvOutcome = (text: string): Outcome => {
  try {
    const r = verdict(parseCsv(text));
    return { refused: false, clean: r.clean, rowsRead: r.rowsRead, errorRows: [...new Set(r.errors.map((e) => e.row))] };
  } catch (e) {
    return { refused: true, clean: false, rowsRead: 0, errorRows: [], message: (e as Error).message };
  }
};
// The tool read the file and reported on its rows (it did not refuse it outright).
const wasRead = (o: Outcome) => !o.refused && o.rowsRead > 0;
const withDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "kiran-rv11-import-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
const xlsx = async (dir: string, name: string, build: (wb: ExcelJS.Workbook) => void) => {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const p = join(dir, name);
  await wb.xlsx.writeFile(p);
  return p;
};
// Rewrite one part of a saved workbook (raw XML), as other software or a hand edit could.
const patchPart = async (p: string, part: string, fn: (xml: string) => string) => {
  const zip = await JSZip.loadAsync(await readFile(p));
  const entry = zip.file(part);
  if (!entry) throw new Error(`${part} not found`);
  const xml = await entry.async("string");
  const out = fn(xml);
  if (out === xml) throw new Error(`patch of ${part} changed nothing`);
  zip.file(part, out);
  await writeFile(p, await zip.generateAsync({ type: "nodebuffer" }));
};

// Results of the REPRODUCTION tests, read by the DEFECT CHECKs that follow them (tests in a file run
// in order).
const seen: {
  phoneHeadings?: Record<string, boolean>;
  zeroWidth?: { area: boolean; name: boolean };
  sheetNameLeak?: Record<string, boolean>;
  phoneTabLeak?: Record<string, boolean>;
  duplicateCell?: { refused: boolean; clean: boolean };
} = {};

describe("P0-02 dry-run (re-verifier-11)", () => {
  it("CONTROL: a phone heading with a space ('Mobile 1') is checked, and the L-0116 D1 quote case is refused", () => {
    const spaced = csvOutcome(
      "Salon Name,Area,Mobile 1,Mobile 2\nTest Salon 01,Gulshan,0399-00000,0399-0000009\nTest Salon 02,Gulshan,hello,0399-0000009\n",
    );
    expect(spaced.clean).toBe(false);
    const quote = csvOutcome('Salon Name,Area,Mobile,Notes\nTest Salon 01,Gulshan,0399-0000001,"abc" x\n');
    expect(quote.refused).toBe(true);
  });

  // P0-02 D1 (runbook: "Every column whose heading names a phone ... is checked"; L-0085 D4 rules a
  // phone-like column left unmapped with a CLEAN result a defect). keyOf never splits letters from
  // digits, so 'Mobile1', 'Mobile2', 'PhoneNo', 'Cell1' stay single words that the phone-word and
  // alias tests never match: the columns are ignored, bad and duplicate numbers pass, CLEAN.
  it("REPRODUCTION (P0-02 D1): files with headings Mobile1/Mobile2, PhoneNo, MobileNo and Cell1 are read", () => {
    const res = {
      mobile12: csvOutcome(
        "Salon Name,Area,Mobile1,Mobile2\nTest Salon 01,Gulshan,0399-00000,0399-0000009\nTest Salon 02,Gulshan,hello,0399-0000009\n",
      ),
      phoneNo: csvOutcome("Salon Name,Area,PhoneNo\nTest Salon 01,Gulshan,0399-00000\n"),
      mobileNo: csvOutcome("Salon Name,Area,MobileNo\nTest Salon 01,Gulshan,hello\n"),
      cell1: csvOutcome("Salon Name,Area,Cell1\nTest Salon 01,Gulshan,0399-00000\n"),
    };
    seen.phoneHeadings = Object.fromEntries(Object.entries(res).map(([k, o]) => [k, o.clean]));
    console.log("rv11 P0-02 D1 clean:", JSON.stringify(seen.phoneHeadings));
    expect(Object.values(res).every(wasRead)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-02 D1): phone headings written with no space before a digit or 'No' are checked", () => {
    expect(seen.phoneHeadings).toEqual({ mobile12: false, phoneNo: false, mobileNo: false, cell1: false });
  });

  // P0-02 D2 (runbook: an empty area, or a name not 2 to 120 characters, is an error). get() only
  // applies String.prototype.trim, which keeps U+200B, so an area of one zero-width space and a name
  // of two pass as CLEAN; the invisible area goes into the territory area list.
  it("REPRODUCTION (P0-02 D2): files with a zero-width area and a zero-width name are read", () => {
    const area = csvOutcome(`Salon Name,Area,Phone\nTest Salon 01,${ZERO_WIDTH_SPACE},0399-0000001\n`);
    const name = csvOutcome(`Salon Name,Area,Phone\n${ZERO_WIDTH_SPACE.repeat(TWO)},Gulshan,0399-0000002\n`);
    seen.zeroWidth = { area: area.clean, name: name.clean };
    console.log("rv11 P0-02 D2:", JSON.stringify({ area, name }));
    expect(wasRead(area) && wasRead(name)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-02 D2): an area or a name made only of zero-width spaces fails the empty and length checks", () => {
    expect(seen.zeroWidth).toEqual({ area: false, name: false });
  });

  // P0-02 D3 (H-03, H-25; runbook and L-0120 D3: other sheet names are shown by position). exceljs
  // checks tab names while loading: over 31 characters it console.warns the full name; a name with
  // / : * ? [ ] or a duplicate puts the full name in a thrown error, which cli.ts prints unchanged.
  // Excel will not save such names, so the file comes from other software or a hand edit.
  it("REPRODUCTION (P0-02 D3): the CLI runs on workbooks whose hidden tabs carry a long, a slashed and a duplicate salon name", async () => {
    const cases: Record<string, [string, string]> = {
      long: ["Test Salon 01 Gulshan Block 13 khata 0399-0000001", "Hidden2"],
      slash: ["Test Salon 01 / Gulshan", "Hidden2"],
      dup: ["Test Salon 02 khata", "Test Salon 02 khata"],
    };
    const runs = await withDir((dir) =>
      Promise.all(
        Object.entries(cases).map(async ([k, [a, b]]) => {
          const p = await xlsx(dir, `${k}.xlsx`, (wb) => {
            wb.addWorksheet("Hidden1", { state: "hidden" }).addRow(["x"]);
            wb.addWorksheet("Hidden2", { state: "hidden" }).addRow(["x"]);
            const ws = wb.addWorksheet("List");
            ws.addRow(["Salon Name", "Area", "Mobile"]);
            ws.addRow(["Test Salon 09", "Gulshan", "0399-0000009"]);
          });
          await patchPart(p, "xl/workbook.xml", (xml) =>
            xml.replace('name="Hidden1"', `name="${a}"`).replace('name="Hidden2"', `name="${b}"`),
          );
          const r = cli(p);
          const out = r.stdout + r.stderr;
          console.log(
            `rv11 P0-02 D3 ${k}: exit ${r.status} |`,
            JSON.stringify(
              out
                .split("\n")
                .filter((l) => SALON_NAME.test(l))
                .slice(0, MAX_LOGGED_LINES),
            ),
          );
          return [k, { ranCli: r.status !== null, leaked: SALON_NAME.test(out) }] as const;
        }),
      ),
    );
    seen.sheetNameLeak = Object.fromEntries(runs.map(([k, v]) => [k, v.leaked]));
    expect(runs.every(([, v]) => v.ranCli)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-02 D3, H-03): exceljs's own sheet-name messages never put a salon-named hidden tab on the console", () => {
    expect(seen.sheetNameLeak).toEqual({ long: false, slash: false, dup: false });
  });

  // P0-02 D4 (runbook: "The report never prints ... full phone numbers"; sheet names only when made
  // of common tab words). isSheetLabel accepts any word of 1 to 4 digits, so a tab named after a
  // phone written in groups is printed in full on the 'Sheet read:' line.
  it("REPRODUCTION (P0-02 D4): the CLI reads workbooks whose only tab is named after a grouped phone number", async () => {
    const tabs = { grouped: "Shop 0399 000 0001", intl: "+92 399 000 0001", dashed: "0399-000-0001" };
    const runs = await withDir((dir) =>
      Promise.all(
        Object.entries(tabs).map(async ([k, tab]) => {
          const p = await xlsx(dir, `${k}.xlsx`, (wb) => {
            const ws = wb.addWorksheet(tab);
            ws.addRow(["Salon Name", "Area", "Mobile"]);
            ws.addRow(["Test Salon 01", "Gulshan Block 13", "0399-0000001"]);
          });
          const r = cli(p);
          const first = r.stdout.split("\n")[0] ?? "";
          console.log(`rv11 P0-02 D4 ${k}: exit ${r.status} |`, JSON.stringify(first));
          return [
            k,
            { read: r.status === 0 && first.startsWith("Sheet read"), leaked: FULL_PHONE.test(`${first}\n${r.stderr}`) },
          ] as const;
        }),
      ),
    );
    seen.phoneTabLeak = Object.fromEntries(runs.map(([k, v]) => [k, v.leaked]));
    expect(runs.every(([, v]) => v.read)).toBe(true);
  });
  it.fails("DEFECT CHECK (P0-02 D4, H-03): a tab named after a phone written in groups is never printed in full", () => {
    expect(seen.phoneTabLeak).toEqual({ grouped: false, intl: false, dashed: false });
  });

  // P0-02 D5 (xlsx-raw.ts header: 'Only a cell positively seen as t="str" with an empty <v> becomes
  // ""'; runbook and L-0085 D2: a formula with no saved result is refused). emptyStringFormulaCells
  // adds an address without checking it appears once. With two <c r="D3"> elements, exceljs keeps
  // the last (an uncalculated formula), xlsx-raw marks D3 empty from the first, and the run is CLEAN.
  // Only a hand-crafted file has duplicate addresses.
  const readWithD3 = (name: string, d3: string) =>
    withDir(async (dir) => {
      const p = await xlsx(dir, name, (wb) => {
        const ws = wb.addWorksheet("List");
        ws.addRow(["Salon Name", "Area", "Phone", "Balance"]);
        ws.addRow(["Test Salon 01", "Gulshan", "0399-0000001", BALANCE_SALON_01]);
        ws.addRow(["Test Salon 02", "Gulshan", "0399-0000002", BALANCE_SALON_02]);
      });
      await patchPart(p, "xl/worksheets/sheet1.xml", (xml) => xml.replace(CELL_D3, d3));
      try {
        const r = verdict(await readTable(p));
        return { refused: false, clean: r.clean, errors: r.errors.map((e) => [e.row, e.field]) };
      } catch (e) {
        return { refused: true, clean: false, errors: [], message: (e as Error).message };
      }
    });
  it("CONTROL (P0-02 D5): a single uncalculated formula in a balance cell is not CLEAN", async () => {
    const control = await readWithD3("single.xlsx", '<c r="D3"><f>A1*1000</f></c>');
    console.log("rv11 P0-02 D5 control:", JSON.stringify(control));
    expect(control.clean).toBe(false);
  });
  it("REPRODUCTION (P0-02 D5): a workbook with a duplicate D3 cell address is read", async () => {
    const dup = await readWithD3("dup.xlsx", '<c r="D3" t="str"><f>""&amp;""</f><v></v></c><c r="D3"><f>A1*1000</f></c>');
    seen.duplicateCell = { refused: dup.refused, clean: dup.clean };
    console.log("rv11 P0-02 D5 dup:", JSON.stringify(dup));
    expect(dup.refused).toBe(false);
  });
  it.fails("DEFECT CHECK (P0-02 D5): a duplicate cell address cannot make an uncalculated formula read as empty", () => {
    expect(seen.duplicateCell?.clean).toBe(false);
  });

  // OBSERVATION O1 (residual risk of L-0116 D1; valid RFC 4180, runbook wording accurate). A field
  // opening with a quote whose stray closing quote ends a later cell (an inch mark) and is followed
  // by a line break swallows the rows in between, errors included.
  it("OBSERVATION: a quote closed by an inch mark at the end of a later line still swallows rows", () => {
    const r = csvOutcome(
      [
        "Salon Name,Area,Phone,Notes",
        "Test Salon 01,Gulshan,0399-0000001,ok",
        'Test Salon 02,Clifton,0399-0000002,"VIP customer',
        "Test Salon 03,Gulshan,0399-00000,bad phone",
        "Test Salon 04,,0399-0000004,no area",
        'Test Salon 05,DHA,0399-0000005,mirror 12"',
        "Test Salon 06,Korangi,0399-0000006,ok",
        "",
      ].join("\r\n"),
    );
    console.log("rv11 P0-02 O1:", JSON.stringify(r));
    expect(typeof r.clean).toBe("boolean");
  });

  // OBSERVATION O2 (repeats the open part of L-0085 O2). An Excel 'Unicode Text' export (UTF-16LE
  // with an FF FE BOM) is decoded as UTF-8: it fails closed, but the message does not say UTF-16.
  it("OBSERVATION: a UTF-16LE .txt export fails closed with a field-mapping message", async () => {
    const r = await withDir(async (dir) => {
      const p = join(dir, "u16.txt");
      await writeFile(
        p,
        Buffer.concat([
          Buffer.from(UTF16LE_BOM),
          Buffer.from("Salon Name\tArea\tPhone\r\nTest Salon 01\tGulshan\t0399-00000\r\n", "utf16le"),
        ]),
      );
      return cli(p);
    });
    console.log("rv11 P0-02 O2: exit", r.status, "| utf16 named:", NAMES_UTF16.test(r.stdout + r.stderr));
    expect(r.status).not.toBe(0);
  });
});
