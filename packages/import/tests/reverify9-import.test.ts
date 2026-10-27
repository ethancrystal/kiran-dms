// Ninth re-verification (ACTIVITY §7) of P0-02, the Excel/CSV salon import dry-run (L-0084).
// Written by the re-verifier-9 subagent, not the builder. All data is synthetic (H-03):
// "Test Salon NN", 0399-prefixed numbers, public locality names. Spreadsheets are generated in a
// temp dir outside the repository and deleted. Nothing touches a database or the network.
//
// "DEFECT CHECK" states the secure expectation: a failure is a defect in the tool. "FALSE
// POSITIVE CHECK" is an honest file that must be read correctly. "CONTROL" passes either way.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv, splitHeader } from "../src/core/csv.ts";
import { normalizePhone, parsePaisa } from "../src/core/normalize.ts";
import { dryRun, formatReport, reportJson } from "../src/core/validate.ts";
import { readTable } from "../src/read.ts";

const PKG = resolve(import.meta.dirname, "..");
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: PKG, encoding: "utf8", env: { ...process.env, INIT_CWD: PKG } });
const verdict = (table: string[][], mapping?: Record<string, string>) => {
  const { headers, rows, firstDataRow } = splitHeader(table);
  return dryRun(headers, rows, { firstDataRow, mapping });
};
const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "kiran-rv9-import-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};
const xlsx = async (dir: string, name: string, build: (wb: ExcelJS.Workbook) => void) => {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const p = join(dir, name);
  await wb.xlsx.writeFile(p);
  return p;
};
const fromXlsx = async (p: string) => verdict(await readTable(p));

describe("P0-02 dry-run (re-verifier-9)", () => {
  it("CONTROL: row numbers, masking, merged / rich-text / hyperlink cells and CSV quoting hold", async () => {
    await withDir(async (dir) => {
      const p = await xlsx(dir, "ok.xlsx", (wb) => {
        const ws = wb.addWorksheet("Salons");
        ws.addRow(["Synthetic salon list"]);
        ws.addRow(["Salon Name", "Area", "Mobile", "Balance"]);
        ws.addRow(["Test Salon 01", "Clifton", 3990000001, 12500]);
        ws.addRow([]);
        ws.addRow([{ richText: [{ text: "Test " }, { text: "Salon 02" }] }, { text: "Saddar", hyperlink: "https://example.test" }, "0399-0000002", ""]);
        ws.addRow(["Test Salon 03", "", "0399-0000001", "x"]);
        ws.mergeCells("B5:B6");
      });
      const r = await fromXlsx(p);
      expect(r.errors.map((e) => [e.row, e.field])).toEqual([[6, "opening_balance"]]);   // spreadsheet row 6
      expect(r.candidates.map((c) => [c.row, c.area])).toEqual([[3, "Clifton"], [5, "Saddar"]]);
      for (const t of [formatReport(r), reportJson(r)]) expect(t).not.toMatch(/Test Salon|0399-?0{3,}\d|\+92\d/);
    });
    expect(parseCsv('a,b\r\n"x\r\ny",2\r\n')).toEqual([["a", "b"], ["x\r\ny", "2"]]);
    expect(cli("tests/fixtures/clean.csv", "--mapping", "tests/fixtures/none.json").status).toBe(2);
  });

  // DEFECT D1 (H-03, H-25). splitHeader takes the row among the first 20 that names the most
  // known columns, else the first row with two non-empty cells. With no recognisable header (a
  // sheet without a header row, or headers in Urdu or Roman Urdu), a DATA row becomes the header,
  // and the report prints header cells verbatim ("Column mapping", "ignored columns"), in text and
  // in the JSON report. The runbook says the report never prints salon names or full phones.
  it("DEFECT CHECK (H-03): with no recognisable header row, the text and JSON reports print a salon name and a full phone", async () => {
    await withDir(async (dir) => {
      const csv = join(dir, "no-header.csv");
      await writeFile(csv, "Test Salon 01,Saddar,0399-0000001\nTest Salon 02,Clifton,0399-0000002\n");
      const run = cli(csv);
      const r = verdict([["Dukan", "Ilaqa", "Qisam", "Fone"], ["Test Salon 01", "Saddar", "Parlour", "0399-0000001"]]);
      const leaks = {
        cliText: /Test Salon|0399-0000001/.test(run.stdout + run.stderr),
        typeWordText: /Test Salon|0399-0000001/.test(formatReport(r)),
        typeWordJson: /Test Salon|0399-0000001/.test(reportJson(r)),
      };
      console.log("rv9 P0-02 D1 leaks:", JSON.stringify(leaks));
      expect(leaks).toEqual({ cliText: false, typeWordText: false, typeWordJson: false });
    });
  });

  // DEFECT D2 (wrong CLEAN; money). cellText() turns a formula whose cached result is an Excel
  // error into "[object Object]" (a valid 15-character salon name or area), and an error cell
  // (e.g. values pasted from a failed VLOOKUP) or a formula with no cached result into "", which
  // the balance parser reads as 0. Each file below is CLEAN today.
  it("DEFECT CHECK (wrong CLEAN): formula errors, error cells and uncached formulas pass as data", async () => {
    await withDir(async (dir) => {
      const head = ["Salon Name", "Area", "Mobile", "Balance"];
      const one = (name: string, row: unknown[]) => xlsx(dir, name, (wb) => { const ws = wb.addWorksheet("Salons"); ws.addRow(head); ws.addRow(row); });
      const nameErr = await fromXlsx(await one("a.xlsx", [{ formula: "VLOOKUP(A9,Z:Z,2,0)", result: { error: "#N/A" } }, "Clifton", "0399-0000001", 1000]));
      const balErrCell = await fromXlsx(await one("b.xlsx", ["Test Salon 02", "Clifton", "0399-0000002", { error: "#REF!" }]));
      const balUncached = await fromXlsx(await one("c.xlsx", ["Test Salon 03", "Clifton", "0399-0000003", { formula: "B9-C9" }]));
      const res = { nameErr: nameErr.clean, balErrCell: balErrCell.clean, balUncached: balUncached.clean };
      console.log("rv9 P0-02 D2 clean:", JSON.stringify(res), nameErr.candidates.map((c) => c.name.length));
      expect(res).toEqual({ nameErr: false, balErrCell: false, balUncached: false });
    });
  });

  // DEFECT D3 (wrong CLEAN). Without --sheet the tool reads wb.worksheets[0] even when it is
  // hidden, and the report does not say which sheet it read. A hidden old sheet that is clean
  // gives CLEAN while the visible sheet the owner is looking at has errors.
  it("DEFECT CHECK (wrong CLEAN): a hidden first sheet is read silently instead of the visible one", async () => {
    await withDir(async (dir) => {
      const p = await xlsx(dir, "hidden.xlsx", (wb) => {
        const old = wb.addWorksheet("Old", { state: "hidden" });
        old.addRow(["Salon Name", "Area"]);
        old.addRow(["Test Salon 01", "Clifton"]);
        const ws = wb.addWorksheet("Salons");
        ws.addRow(["Salon Name", "Area", "Mobile"]);
        ws.addRow(["", "Clifton", "3.99E+09"]);
      });
      let v: boolean | "refused";
      try { v = (await fromXlsx(p)).clean; } catch { v = "refused"; }
      console.log("rv9 P0-02 D3 verdict:", v);
      expect(v).not.toBe(true);
    });
  });

  // DEFECT D4 (wrong CLEAN). The prefix pass gives "Contact Mobile" to contact_name ("contact "
  // prefix) and leaves "Owner Mobile" unmapped when "Owner Name" exists, so the phone column is
  // never validated: Excel-damaged numbers pass with only a "no phone" warning.
  it("DEFECT CHECK (wrong CLEAN): phone columns headed Contact Mobile or Owner Mobile are not validated", () => {
    const contactMobile = verdict([["Salon Name", "Area", "Contact Mobile"], ["Test Salon 01", "Clifton", "3.99E+09"]]);
    const ownerMobile = verdict([["Salon Name", "Area", "Owner Name", "Owner Mobile"], ["Test Salon 01", "Clifton", "Test Owner A", "3.99E+09"]]);
    const res = { contactMobile: contactMobile.clean, ownerMobile: ownerMobile.clean };
    console.log("rv9 P0-02 D4 clean:", JSON.stringify(res), JSON.stringify(contactMobile.mapping));
    expect(res).toEqual({ contactMobile: false, ownerMobile: false });
  });

  // DEFECT D5 (phone). A mobile number missing one digit ("0399-000000", 10 digits) matches the
  // landline rule /^0[1-9]\d{8,9}$/ and is imported with only a landline warning; so does
  // "92399000000". No Pakistani landline area code starts with 3; 03 is the mobile prefix.
  it("DEFECT CHECK (phone): a truncated mobile number is accepted as a landline", () => {
    const res = { local: normalizePhone("0399-000000").ok, intl: normalizePhone("92399000000").ok };
    console.log("rv9 P0-02 D5 ok:", JSON.stringify(res));
    expect(res).toEqual({ local: false, intl: false });
  });

  // DEFECT D6 (money sign). "(-1,000)" is read as +1,000: the brackets and the minus cancel. An
  // owner writing both marks means a negative (credit) balance; the safe reading is an error.
  it("DEFECT CHECK (money): a bracketed negative with a minus sign becomes a positive balance", () => {
    const r = parsePaisa("(-1,000)");
    console.log("rv9 P0-02 D6:", JSON.stringify(r, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
    expect(r.ok && r.value > 0n).toBe(false);
  });

  // FALSE POSITIVE FP1. South Asian digit grouping (lakh: 1,25,000) is how owners commonly write
  // amounts in Pakistan (typed text cells, or a CSV holding formatted text).
  it("FALSE POSITIVE CHECK (money): lakh-grouped amounts are refused", () => {
    expect(parsePaisa("1,25,000")).toEqual({ ok: true, value: 12500000n });
    expect(parsePaisa("Rs 12,50,000/-")).toEqual({ ok: true, value: 125000000n });
  });

  // FALSE POSITIVE FP2. A cached formula result can carry binary float noise (=1500*1.1 gives
  // 1650.0000000000002 in IEEE doubles, written so by exceljs). Excel displays 1,650, but
  // String(number) keeps the noise and the row is refused.
  it("FALSE POSITIVE CHECK (money): a formula balance with binary float noise is refused", async () => {
    await withDir(async (dir) => {
      const p = await xlsx(dir, "float.xlsx", (wb) => {
        const ws = wb.addWorksheet("Salons");
        ws.addRow(["Salon Name", "Area", "Balance"]);
        ws.addRow(["Test Salon 01", "Clifton", { formula: "1500*1.1", result: 1500 * 1.1 }]);
      });
      const r = await fromXlsx(p);
      console.log("rv9 P0-02 FP2:", r.clean, JSON.stringify(r.errors));
      expect(r.clean).toBe(true);
      expect(r.candidates[0]?.openingBalancePaisa).toBe(165000n);
    });
  });

  // FALSE POSITIVE FP3. A title line that starts with "Salon" matches a name alias, so above
  // headers the guess does not know (the runbook's own "Dukan" / "Ilaqa" case) the title becomes
  // the header. The runbook's remedy, --mapping, is applied after the header row is chosen, so it
  // cannot fix it: every mapped column is reported missing and the honest file never passes.
  it("FALSE POSITIVE CHECK (header): a title line above Roman Urdu headers defeats --mapping", async () => {
    await withDir(async (dir) => {
      const csv = join(dir, "salons.csv");
      const map = join(dir, "map.json");
      await writeFile(csv, "Salon list 2026\nDukan,Ilaqa,Fone\nTest Salon 01,Saddar,0399-0000001\n");
      await writeFile(map, JSON.stringify({ name: "Dukan", area: "Ilaqa", phone: "Fone" }));
      const run = cli(csv, "--mapping", map);
      console.log("rv9 P0-02 FP3 status:", run.status);
      expect(run.status, run.stdout).toBe(0);
    });
  });
});
