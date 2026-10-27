// File readers for the dry-run (the only I/O besides the CLI). .xlsx via exceljs (the npm
// `xlsx` package is avoided: its registry release has unpatched advisories); .csv or .txt by hand.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parseCsv } from "./core/csv.ts";
import { NO_RESULT } from "./core/normalize.ts";

// What the reader did, for the report: which sheet it read and which hidden sheets it skipped.
export type ReadInfo = { sheet?: string; hiddenSkipped?: string[]; sheetHidden?: boolean };

export async function readTable(path: string, sheet?: string, info: ReadInfo = {}): Promise<string[][]> {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv" || ext === ".txt") return parseCsv(await readFile(path, "utf8"));
  if (ext === ".xls") throw new Error("old .xls files are not supported: open the file in Excel and Save As .xlsx or .csv");
  if (ext !== ".xlsx") throw new Error(`unsupported file type "${ext}": use .xlsx or .csv`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  // Without --sheet, the first VISIBLE sheet: a hidden old sheet must not be checked in place of
  // the one the owner is looking at (L-0085 P0-02 D3).
  const visible = (w: ExcelJS.Worksheet) => w.state === undefined || w.state === "visible";
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets.find(visible);
  if (!ws) {
    const names = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(sheet ? `no sheet named "${sheet}" (sheets: ${names})` : `the workbook has no visible sheets (sheets: ${names})`);
  }
  info.sheet = ws.name;
  info.sheetHidden = !visible(ws);
  info.hiddenSkipped = sheet ? [] : wb.worksheets.slice(0, wb.worksheets.indexOf(ws)).map((w) => w.name);

  const table: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c)));
    table.push(cells);
  }
  return table;
}

// Binary floating-point noise in a stored result (1500*1.1 is 1650.0000000000002) is dropped
// at 15 significant digits, as Excel itself displays it (L-0085 P0-02 FP2).
const num = (n: number) => String(Number(n.toPrecision(15)));

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null && "error" in v) return String((v as { error: unknown }).error);   // "#N/A", "#REF!", ...
  if (typeof v === "object" && v !== null && "richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join("");
  return "";
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v !== null && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    const result = (v as { result?: unknown }).result;
    return result === undefined || result === null ? NO_RESULT : scalar(result);   // never "" or 0 (D2)
  }
  if (v !== null && typeof v === "object" && "text" in v && "hyperlink" in v) return scalar((v as ExcelJS.CellHyperlinkValue).text);
  return scalar(v);
}
