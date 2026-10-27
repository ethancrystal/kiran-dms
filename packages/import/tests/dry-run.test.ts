// P0-02 dry-run tests. All data is synthetic (H-03): "Test Salon NN", "Test Owner X" and
// 0399-prefixed numbers; areas are the public locality names used in doc 02.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv, splitHeader } from "../src/core/csv.ts";
import { resolveMapping } from "../src/core/mapping.ts";
import { mapSalonType, maskPhone, normalizePhone, parseGeo, parsePaisa } from "../src/core/normalize.ts";
import { dryRun, formatReport, reportJson } from "../src/core/validate.ts";
import { readTable } from "../src/read.ts";

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
