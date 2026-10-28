// P0-02 dry-run tests. All data is synthetic (H-03): "Test Salon NN", "Test Owner X" and
// 0399-prefixed numbers; areas are the public locality names used in doc 02.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv, splitHeader } from "../src/core/csv.ts";
import { resolveMapping } from "../src/core/mapping.ts";
import { keyOf, mapSalonType, maskPhone, normalizePhone, parseGeo, parsePaisa } from "../src/core/normalize.ts";
import { dryRun, formatReport, reportJson } from "../src/core/validate.ts";
import { readTable } from "../src/read.ts";
import { emptyStringFormulaCells } from "../src/xlsx-raw.ts";

const PKG = resolve(import.meta.dirname, "..");
const fixture = (n: string) => join(PKG, "tests/fixtures", n);
const run = async (n: string, opts = {}) => {
  const { headers, rows, firstDataRow } = splitHeader(await readTable(fixture(n)));
  return dryRun(headers, rows, { firstDataRow, ...opts });
};
// INIT_CWD is where pnpm was invoked (the CLI resolves paths against it); pin it to the
// package so the result does not depend on whether the suite runs from the root or here.
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: PKG, encoding: "utf8", env: { ...process.env, INIT_CWD: PKG } });

describe("normalisers", () => {
  it("phones: mobiles in every common spelling become +92; Excel damage is an error", () => {
    for (const v of ["0399-0000001", "03990000001", "+92 399 0000001", "0092 399 0000001", "3990000001", "(0399) 000-0001"]) {
      expect(normalizePhone(v)).toEqual({ ok: true, value: "+923990000001" });
    }
    expect(normalizePhone("3.99E+09").ok).toBe(false);
    expect(normalizePhone("call shop").ok).toBe(false);
    expect(normalizePhone("12345").ok).toBe(false);
    const land = normalizePhone("021-00000020");
    expect(land.ok && land.value === "+922100000020" && land.warning).toMatch(/landline/);
  });

  it("money: rupee strings become integer paisa (bigint), never floats", () => {
    expect(parsePaisa("12,500")).toEqual({ ok: true, value: 1250000n });
    expect(parsePaisa("Rs 4500.50")).toEqual({ ok: true, value: 450050n });
    expect(parsePaisa("2,000/-")).toEqual({ ok: true, value: 200000n });
    expect(parsePaisa("(1,500)")).toEqual({ ok: true, value: -150000n });
    expect(parsePaisa("")).toEqual({ ok: true, value: 0n });
    expect(parsePaisa("12,50").ok).toBe(false);
    expect(parsePaisa("4500.505").ok).toBe(false);
    expect(parsePaisa("about 500").ok).toBe(false);
  });

  it("types map to the doc 04 enum; unknown words fall back to other with a warning", () => {
    expect(mapSalonType("Ladies Beauty Parlour")).toEqual({ ok: true, value: "ladies_parlor" });
    expect(mapSalonType("GENTS SALON")).toEqual({ ok: true, value: "mens_salon" });
    expect(mapSalonType("Home Parlour")).toEqual({ ok: true, value: "home_parlor" });
    expect(mapSalonType("spa_wellness")).toEqual({ ok: true, value: "spa_wellness" });
    expect(mapSalonType("Beauty Academy")).toEqual({ ok: true, value: "academy" });
    // Labels with more than one keyword (council finding 10).
    expect(mapSalonType("Ladies & Gents Salon")).toEqual({ ok: true, value: "unisex" });
    expect(mapSalonType("Gents and Ladies Parlour")).toEqual({ ok: true, value: "unisex" });
    expect(mapSalonType("Gents Salon")).toEqual({ ok: true, value: "mens_salon" });
    expect(mapSalonType("Hair Studio")).toEqual({ ok: true, value: "hair_studio" });
    const nail = mapSalonType("Nail Studio");
    expect(nail.ok && nail.value === "other" && nail.warning).toBeTruthy();
    const x = mapSalonType("xyz");
    expect(x.ok && x.value === "other" && x.warning).toBeTruthy();
  });

  it("geo: both or neither; swapped coordinates are flagged", () => {
    expect(parseGeo("", "")).toEqual({ ok: true, value: null });
    expect(parseGeo("24.8", "").ok).toBe(false);
    expect(parseGeo("24.86", "67.03")).toEqual({ ok: true, value: { lat: 24.86, lng: 67.03 } });
    const s = parseGeo("67.03", "24.86");
    expect(s.ok && s.warning).toMatch(/swapped/);
  });

  it("masking keeps only the last four digits", () => {
    expect(maskPhone("+923990000001")).toBe("03xx-xxx-0001");
  });
});

describe("mapping", () => {
  it("two columns with the same heading are a file problem, never a silent drop (council finding 8)", () => {
    const r = dryRun(["Salon Name", "Area", "Mobile", "mobile "], [["Test Salon 01", "Clifton", "0399-0000001", "0399-0000002"]]);
    expect(r.clean).toBe(false);
    expect(r.fatal.join(" ")).toMatch(/"Mobile" heads more than one column \(columns C, D\)/);
    const dataRow = dryRun(["Test Salon 01", "Saddar", "Test Salon 01"], [["x", "y", "z"]]);
    expect(dataRow.fatal.join(" ")).toMatch(/a heading heads more than one column \(columns A, C\)/);
    expect(formatReport(dataRow)).not.toMatch(/Test Salon/);
  });

  it("guesses columns from common headers and lists the rest as ignored", () => {
    const m = resolveMapping(["Sr No", "Salon Name", "Type", "Area", "Mobile No", "Owner Name", "Balance", "Colour"]);
    expect(m.mapping).toMatchObject({ ref: "Sr No", name: "Salon Name", type: "Type", area: "Area", phone: "Mobile No", contact_name: "Owner Name", opening_balance: "Balance" });
    expect(m.unmappedHeaders).toEqual(["Colour"]);
    expect(m.missingRequired).toEqual([]);
  });

  it("an explicit mapping wins; mistakes in it are file problems", () => {
    const m = resolveMapping(["Dukan", "Ilaqa", "Mobile"], { name: "Dukan", area: "ilaqa", nope: "Mobile", phone: "Missing" });
    expect(m.mapping).toMatchObject({ name: "Dukan", area: "Ilaqa", phone: "Mobile" });
    expect(m.problems).toHaveLength(2);
  });

  it("a missing required column makes the run fatal and not clean", () => {
    const r = dryRun(["Salon Name", "Phone"], [["Test Salon 01", "0399-0000001"]]);
    expect(r.clean).toBe(false);
    expect(r.fatal.join(" ")).toMatch(/area/);
  });
});

describe("dry run on synthetic files", () => {
  it("a clean file passes, with areas, types and balances summarised", async () => {
    const r = await run("clean.csv");
    expect(r.errors).toEqual([]);
    expect(r.clean).toBe(true);
    expect(r.rowsRead).toBe(6);
    expect(r.rowsValid).toBe(6);
    expect(r.areas.map((a) => [a.area, a.salons])).toEqual([["Clifton", 2], ["Gulshan Block 13", 2], ["North Nazimabad", 2]]);
    expect(r.balances).toEqual({ salonsWithBalance: 3, totalPaisa: String(1250000 + 450050 + 200000), creditBalances: 0 });
    expect(r.candidates[3].phones).toEqual(["+923990000004", "+923990000005"]);
    expect(r.candidates.every((c) => c.source === "excel_import")).toBe(true);
    expect(r.errors.concat(r.warnings).every((x) => x.row >= 3)).toBe(true);   // title line, then header on row 2
  });

  it("a messy file is not clean, and every problem points at its spreadsheet row", async () => {
    const r = await run("messy.csv");
    expect(r.clean).toBe(false);
    expect(r.rowsRead).toBe(11);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([
      [2, "name"], [3, "area"], [4, "phone"], [5, "phone"], [6, "chairs"], [7, "opening_balance"], [8, "lat"],
    ]);
    expect(r.rowsValid).toBe(4);
    const w = r.warnings.map((x) => `${x.row}:${x.field}:${x.message}`).join("\n");
    expect(w).toMatch(/9:type:type not recognised/);
    expect(w).toMatch(/9:opening_balance:negative balance/);
    expect(w).toMatch(/9:phone:phone 03xx-xxx-0099 is on 2 salons/);
    expect(w).toMatch(/10:lat:latitude and longitude look swapped/);
    expect(w).toMatch(/11:phone:landline/);
    expect(w).toMatch(/11:row:same name and area as rows 12/);
    expect(w).toMatch(/12:phone:no phone/);
  });

  it("an area list turns unknown areas into warnings", async () => {
    const r = await run("clean.csv", { knownAreas: ["Clifton", "gulshan block 13"] });
    expect(r.clean).toBe(true);
    expect(r.warnings.filter((x) => x.field === "area").map((x) => x.row)).toEqual([5, 6]);
    expect(r.areas.find((a) => a.area === "North Nazimabad")?.known).toBe(false);
  });

  it("reports never contain names, addresses or full phone numbers (H-03)", async () => {
    for (const f of ["clean.csv", "messy.csv"]) {
      const r = await run(f);
      for (const text of [formatReport(r), reportJson(r)]) {
        expect(text).not.toMatch(/Test Salon|Test Owner|Test Street/);
        expect(text).not.toMatch(/399\s?-?0{3,}\d/);
        expect(text).not.toMatch(/\+92\d/);
      }
    }
  });
});

describe("readers", () => {
  it("CSV: an unterminated quoted field refuses the file instead of swallowing rows (council finding 9)", () => {
    expect(() => parseCsv('Salon Name,Area\n"Test Salon 01,Clifton\nTest Salon 02,Saddar\n')).toThrow(/opened on line 2 is never closed/);
  });

  it("CSV: quotes, embedded commas and newlines, semicolons and a BOM", () => {
    expect(parseCsv('﻿a;b\n"x;1";"he said ""hi""\nbye"\r\n')).toEqual([["a", "b"], ["x;1", 'he said "hi"\nbye']]);
  });

  it("xlsx: numeric phone cells and formulas read like the CSV export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kiran-import-"));
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Salons");
      ws.addRow(["Salon Name", "Area", "Mobile", "Balance"]);
      ws.addRow(["Test Salon 01", "Clifton", 3990000001, 12500]);
      ws.addRow(["Test Salon 02", "Clifton", "0399-0000002", { formula: "1000+500", result: 1500 }]);
      const p = join(dir, "synthetic.xlsx");
      await wb.xlsx.writeFile(p);
      const { headers, rows, firstDataRow } = splitHeader(await readTable(p));
      const r = dryRun(headers, rows, { firstDataRow });
      expect(r.clean).toBe(true);
      expect(r.candidates.map((c) => [c.phones[0], c.openingBalancePaisa])).toEqual([["+923990000001", 1250000n], ["+923990000002", 150000n]]);
      await expect(readTable(p, "Nope")).rejects.toThrow(/no sheet named/);
      await expect(readTable(join(dir, "old.xls"))).rejects.toThrow(/Save As/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("command line", () => {
  it("exit code 0 when clean, 1 when not, 2 when the file cannot be read", () => {
    const ok = cli("tests/fixtures/clean.csv");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/Result: CLEAN/);
    expect(ok.stderr).not.toMatch(/WARNING/);       // fixtures under tests/ are allowed
    const bad = cli("tests/fixtures/messy.csv");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/Result: NOT CLEAN/);
    expect(cli("tests/fixtures/none.csv").status).toBe(2);
    expect(cli().status).toBe(2);
    expect(cli("tests/fixtures/clean.csv", "--bogus").status).toBe(2);
  });

  it("warns when the input file sits inside the repository outside tests/ (H-03)", () => {
    const r = cli("package.json");
    expect(r.stderr).toMatch(/inside the repository/);
  });

  it("--json writes a masked report only under the git-ignored import-reports/", async () => {
    const dir = resolve(PKG, "../../import-reports");
    const before = new Set(await readdir(dir).catch(() => [] as string[]));
    const r = cli("tests/fixtures/messy.csv", "--json");
    expect(r.status).toBe(1);
    const added = (await readdir(dir)).filter((f) => !before.has(f));
    expect(added).toHaveLength(1);
    try {
      const body = await readFile(join(dir, added[0]), "utf8");
      expect(JSON.parse(body).candidates).toBe(4);
      expect(body).not.toMatch(/Test Salon|\+92\d/);
    } finally {
      await rm(join(dir, added[0]));
    }
  });
});

// Fixes for the round-10 re-verification (L-0116, P0-02 D1 to D4, FP1, O1). Synthetic data only.
const check = (table: string[][], mapping?: Record<string, string>) => {
  const { headers, rows, firstDataRow } = splitHeader(table, mapping);
  return dryRun(headers, rows, { firstDataRow, mapping });
};
const withTmp = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "kiran-import-l0116-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

describe("L-0116 D1 and O1: CSV quotes", () => {
  const head = [
    "Salon Name,Area,Mobile,Notes",
    "Test Salon 01,Gulshan,0399-0000001,ok",
    'Test Salon 02,Clifton,0399-0000002,"Corner shop',
    "Test Salon 03,Saddar,0399-000000,bad phone",
    'Test Salon 05,Gulshan,0399-0000005,has 12" mirror',
    "Test Salon 06,Saddar,0399-0000006,ok",
  ];

  it("a quote closed by a stray quote on a later line refuses the file, naming both lines and no cell text", () => {
    for (const eol of ["\n", "\r\n", "\r"]) {
      let msg = "";
      try { parseCsv(head.join(eol) + eol); } catch (e) { msg = (e as Error).message; }
      expect(msg, JSON.stringify(eol)).toMatch(/opened on line 3 is closed on line 5 by a quote mark that is followed by more text/);
      expect(msg).not.toMatch(/Corner|mirror|Test Salon/);
    }
  });

  it("text right after a closing quote on the same line is refused; a closing quote before a delimiter, a line break or the end is fine", () => {
    expect(() => parseCsv('Salon Name,Area\n"Test Salon 01" x,Clifton\n')).toThrow(/opened on line 2 is closed on line 2/);
    expect(() => parseCsv('Salon Name,Area\n"Test Salon 01" ,Clifton\n')).toThrow(/followed by more text/);
    expect(parseCsv('a,b\n"x","y"\n"z","w"')).toEqual([["a", "b"], ["x", "y"], ["z", "w"]]);
    expect(parseCsv('a,b\r"x","y"\r')).toEqual([["a", "b"], ["x", "y"]]);
    expect(parseCsv('a;b\n"x";""\n')).toEqual([["a", "b"], ["x", ""]]);
    // A quote inside an unquoted field (an inch mark) is kept as text, as before.
    expect(parseCsv('a,b\n12" mirror,x\n')).toEqual([["a", "b"], ['12" mirror', "x"]]);
  });

  it("CR-only files: line numbers count CR, and the delimiter is detected per line", () => {
    const open = ["Salon Name;Area;Mobile", "Test Salon 01;Gulshan;0399-0000001", 'Test Salon 02;"Clifton;0399-0000002'].join("\r");
    expect(() => parseCsv(open)).toThrow(/opened on line 3 is never closed/);
    expect(parseCsv("Salon Name;Area\rTest Salon 01;Gulshan\r")).toEqual([["Salon Name", "Area"], ["Test Salon 01", "Gulshan"]]);
    // A quoted CRLF inside a field still counts as one line break.
    expect(() => parseCsv('a,b\r\n"x\r\ny",2\r\n"open,3\r\n')).toThrow(/opened on line 4 is never closed/);
  });
});

describe("L-0116 D2: invisible characters in headings", () => {
  it("keyOf drops format characters, other default-ignorables and combining marks instead of splitting the word", () => {
    for (const h of ["Ph​one", "Ph­one", "Ph⁠one", "Ph﻿one", "Phㅤone", "P‎hone"]) expect(keyOf(h), JSON.stringify(h)).toBe("phone");
    expect(keyOf("Mob‌ile No")).toBe("mobile no");
    expect(keyOf("Salon  Name!")).toBe("salon name");
  });

  it("a second phone heading with an invisible character is a duplicate heading, so the run is not clean", () => {
    for (const [a, b] of [["Phone", "Ph​one"], ["Phone", "Ph­one"], ["Mobile", "Mob‌ile"]]) {
      const r = check([["Salon Name", "Area", a, b], ["Test Salon 01", "Gulshan", "0399-0000001", "0399-000"]]);
      expect(r.clean, b).toBe(false);
      expect(r.fatal.join(" ")).toMatch(/heads more than one column \(columns C, D\)/);
    }
  });
});

describe("L-0116 D4: header rows found only by partial matches", () => {
  const noHeader = [
    ["Salon Colour", "Block 13", "0399-0000001"],
    ["Test Salon 02", "Clifton", "0399-0000002"],
    ["Test Salon 03", "Saddar", "0399-0000003"],
  ];

  it("a data row matching fields only by prefix is refused as the header, and none of its cells is printed", () => {
    const r = check(noHeader);
    expect(r.clean).toBe(false);
    expect(r.headerRow).toBe(1);
    expect(r.fatal.join(" ")).toMatch(/row 1 was taken as the header, but fewer than two of its headings are ones the tool knows exactly/);
    expect(r.mapping).toEqual({ name: "column A", area: "column B" });
    for (const t of [formatReport(r), reportJson(r)]) expect(t).not.toMatch(/Salon Colour|Block 13|0399/);
  });

  it("one exact match plus a prefix match (a type cell reading Salon) is not enough either", () => {
    const r = check([["Test Salon 01", "Salon", "Block 13", "0399-0000001"], ["Test Salon 02", "Barber", "Clifton", "0399-0000002"]]);
    expect(r.clean).toBe(false);
    expect(formatReport(r) + reportJson(r)).not.toMatch(/Test Salon|Block 13|"Salon"/);
  });

  it("a plain header below a prefix-matching data row wins, and the report says which row is the header", () => {
    const r = check([["Salon Colour", "Block 13", ""], ["Name", "Area", "Mobile"], ["Test Salon 02", "Clifton", "0399-0000002"]]);
    expect(r.headerRow).toBe(2);
    expect(r.clean).toBe(true);
    expect(formatReport(r)).toMatch(/Header row: 2 \(rows 1 to 1 above it are not read\)/);
  });

  it("--mapping confirms headings the tool knows only by prefix", () => {
    const table = [["Salon Name (Urdu)", "Area Block", "Mobile"], ["Test Salon 01", "Gulshan", "0399-0000001"]];
    expect(check(table).clean).toBe(false);
    const r = check(table, { name: "Salon Name (Urdu)", area: "Area Block" });
    expect(r.clean).toBe(true);
    expect(r.fatal).toEqual([]);
    expect(formatReport(r)).toMatch(/Header row: 1\n/);
  });

  it("ordinary headings still pass (title line above, exact aliases, area name)", async () => {
    expect((await run("clean.csv")).headerRow).toBe(2);
    expect(check([["Shop Name", "Area Name", "Owner Mobile"], ["Test Salon 01", "Gulshan", "0399-0000001"]]).clean).toBe(true);
  });
});

describe("L-0116 D3: sheet names are not printed unless they are common tab words", () => {
  it("hidden sheets are counted by position and a wrong --sheet does not list the names", async () => {
    await withTmp(async (dir) => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("Test Salon 01 khata", { state: "hidden" }).addRow(["x"]);
      wb.addWorksheet("Test Salon 02 khata", { state: "hidden" }).addRow(["x"]);
      wb.addWorksheet("Test Salon 03 khata", { state: "veryHidden" }).addRow(["x"]);
      const ws = wb.addWorksheet("List");
      ws.addRow(["Salon Name", "Area", "Mobile"]);
      ws.addRow(["Test Salon 09", "Gulshan", "0399-0000009"]);
      wb.addWorksheet("Test Salon 04 khata").addRow(["x"]);
      const p = join(dir, "ledger.xlsx");
      await wb.xlsx.writeFile(p);

      const plain = cli(p);
      expect(plain.status, plain.stderr).toBe(0);
      expect(plain.stdout.split("\n")[0]).toBe('Sheet read: "List" (sheet 4) of 5; hidden sheets skipped: 3 (sheets 1, 2, 3)');
      const wrong = cli(p, "--sheet", "Nope");
      expect(wrong.status).toBe(2);
      expect(wrong.stderr).toMatch(/no sheet named "Nope" \(the workbook has 5 sheets: "List" \(sheet 4\); 4 other sheet names are not printed/);
      const hidden = cli(p, "--sheet", "Test Salon 02 khata");
      expect(hidden.stdout.split("\n")[0]).toBe("Sheet read: sheet 2 of 5 (HIDDEN sheet, chosen with --sheet)");
      for (const r of [plain, wrong]) expect(r.stdout + r.stderr).not.toMatch(/khata|Test Salon/);
      // A hidden sheet chosen by name is still shown by position on success.
      expect(hidden.stdout).not.toMatch(/khata|Test Salon/);
    });
  });
});

describe("L-0116 FP1: a formula whose saved result is the empty string", () => {
  it("reads as an empty cell; a formula with no saved result is still refused; a text result is still read", async () => {
    await withTmp(async (dir) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Salons & Co");
      ws.addRow(["Salon Name", "Area", "Mobile", "Balance"]);
      ws.addRow(["Test Salon 01", "Gulshan", "0399-0000001", { formula: 'IF(1=0,5,"")', result: "" }]);
      ws.addRow(["Test Salon 02", "Gulshan", "0399-0000002", { formula: 'IF(1=1,"Rs 500","")', result: "Rs 500" }]);
      ws.addRow(["Test Salon 03", "Clifton", "0399-0000003", { formula: "B9-C9" }]);
      const p = join(dir, "blank.xlsx");
      await wb.xlsx.writeFile(p);
      expect([...(await emptyStringFormulaCells(p, "Salons & Co"))]).toEqual(["D2"]);
      const { headers, rows, firstDataRow } = splitHeader(await readTable(p));
      const r = dryRun(headers, rows, { firstDataRow });
      expect(r.errors.map((e) => [e.row, e.field])).toEqual([[4, "opening_balance"]]);
      expect(r.errors[0].message).toMatch(/formula with no saved result/);
      expect(r.candidates.map((c) => [c.row, c.openingBalancePaisa])).toEqual([[2, 0n], [3, 50000n]]);
    });
  });

  it("a shared formula dragged down a column with empty results reads as empty cells", async () => {
    await withTmp(async (dir) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Salons");
      ws.addRow(["Salon Name", "Area", "Mobile", "Balance"]);
      ws.addRow(["Test Salon 01", "Gulshan", "0399-0000001"]);
      ws.addRow(["Test Salon 02", "Gulshan", "0399-0000002"]);
      ws.getCell("D2").value = { formula: 'IF(1=0,5,"")', result: "", shareType: "shared", ref: "D2:D3" } as ExcelJS.CellValue;
      ws.getCell("D3").value = { sharedFormula: "D2", result: "" } as ExcelJS.CellValue;
      const p = join(dir, "shared.xlsx");
      await wb.xlsx.writeFile(p);
      expect([...(await emptyStringFormulaCells(p, "Salons"))].sort()).toEqual(["D2", "D3"]);
      const { headers, rows, firstDataRow } = splitHeader(await readTable(p));
      const r = dryRun(headers, rows, { firstDataRow });
      expect(r.errors).toEqual([]);
      expect(r.clean).toBe(true);
    });
  });

  it("fails closed: a file it cannot read as a workbook, or a sheet it cannot find, gives no cells", async () => {
    await withTmp(async (dir) => {
      const p = join(dir, "not-a-zip.xlsx");
      await writeFile(p, "Salon Name,Area\n");
      expect((await emptyStringFormulaCells(p, "Sheet1")).size).toBe(0);
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("Salons").addRow(["a", { formula: 'IF(1=0,5,"")', result: "" }]);
      const q = join(dir, "ok.xlsx");
      await wb.xlsx.writeFile(q);
      expect((await emptyStringFormulaCells(q, "Other")).size).toBe(0);
      expect((await emptyStringFormulaCells(q, "Salons")).size).toBe(1);
    });
  });
});
