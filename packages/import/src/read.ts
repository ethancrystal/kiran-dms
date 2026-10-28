// File readers for the dry-run (the only I/O besides the CLI). .xlsx via exceljs (the npm
// `xlsx` package is avoided: its registry release has unpatched advisories); .csv or .txt by hand.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parseCsv } from "./core/csv.ts";
import { isSheetLabel } from "./core/mapping.ts";
import { NO_RESULT } from "./core/normalize.ts";
import { emptyStringFormulaCells } from "./xlsx-raw.ts";

// What the reader did, for the report: which sheet it read (its name, and its 1-based position
// in tab order counting hidden sheets) and the positions of the hidden sheets it skipped. Sheet
// names can be salon names (one tab per salon), so the CLI prints a name only when isSheetLabel
// allows it and positions otherwise (H-03, L-0116 P0-02 D3).
export type ReadInfo = { sheet?: string; sheetPosition?: number; sheetCount?: number; hiddenSkipped?: number[]; sheetHidden?: boolean };

// A sheet as the reports may show it: its name when it is made of common tab words, else its position.
export const sheetLabel = (name: string, position: number) => (isSheetLabel(name) ? `"${name}" (sheet ${position})` : `sheet ${position}`);

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
    // Never list every sheet name: they may be salon names (L-0116 P0-02 D3). Names made of
    // common tab words are shown; the rest are counted. The --sheet value is the user's own.
    const shown = wb.worksheets.map((w, i) => (isSheetLabel(w.name) ? sheetLabel(w.name, i + 1) : null)).filter(Boolean);
    const hidden = wb.worksheets.length - shown.length;
    const list = `the workbook has ${wb.worksheets.length} sheet${wb.worksheets.length === 1 ? "" : "s"}` +
      (shown.length ? `: ${shown.join(", ")}` : "") +
      (hidden ? `${shown.length ? "; " : ", "}${hidden} other sheet name${hidden === 1 ? " is" : "s are"} not printed because a sheet name may be a salon name` : "");
    throw new Error(sheet ? `no sheet named "${sheet}" (${list})` : `the workbook has no visible sheets (${list})`);
  }
  info.sheet = ws.name;
  info.sheetPosition = wb.worksheets.indexOf(ws) + 1;
  info.sheetCount = wb.worksheets.length;
  info.sheetHidden = !visible(ws);
  info.hiddenSkipped = sheet ? [] : wb.worksheets.slice(0, wb.worksheets.indexOf(ws)).map((_, i) => i + 1);

  // Formulas with no saved result in exceljs's view: find those whose saved result is in fact
  // the empty string, so they read as empty cells rather than being refused (L-0116 P0-02 FP1).
  const noResult = (c: ExcelJS.Cell) => {
    const v = c.value;
    return v !== null && typeof v === "object" && ("formula" in v || "sharedFormula" in v) &&
      ((v as { result?: unknown }).result === undefined || (v as { result?: unknown }).result === null);
  };
  let anyNoResult = false;
  ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => { if (noResult(c)) anyNoResult = true; }));
  const emptyStr = anyNoResult ? await emptyStringFormulaCells(path, ws.name) : new Set<string>();

  const table: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c), emptyStr));
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

function cellText(cell: ExcelJS.Cell, emptyStr: Set<string>): string {
  const v = cell.value;
  if (v !== null && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    const result = (v as { result?: unknown }).result;
    if (result !== undefined && result !== null) return scalar(result);
    // A saved result that is the empty string, seen in the file itself, is an empty cell. Any
    // other formula without a saved result is refused, never read as "" or 0 (L-0085 D2).
    return emptyStr.has(cell.address.toUpperCase()) ? "" : NO_RESULT;
  }
  if (v !== null && typeof v === "object" && "text" in v && "hyperlink" in v) return scalar((v as ExcelJS.CellHyperlinkValue).text);
  return scalar(v);
}
