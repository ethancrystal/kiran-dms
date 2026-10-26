// File readers for the dry-run (the only I/O besides the CLI). .xlsx via exceljs (the npm
// `xlsx` package is avoided: its registry release has unpatched advisories); .csv by hand.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parseCsv } from "./core/csv.ts";

export async function readTable(path: string, sheet?: string): Promise<string[][]> {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv" || ext === ".txt") return parseCsv(await readFile(path, "utf8"));
  if (ext === ".xls") throw new Error("old .xls files are not supported: open the file in Excel and Save As .xlsx or .csv");
  if (ext !== ".xlsx") throw new Error(`unsupported file type "${ext}": use .xlsx or .csv`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) {
    const names = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(sheet ? `no sheet named "${sheet}" (sheets: ${names})` : "the workbook has no sheets");
  }
  const table: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c)));
    table.push(cells);
  }
  return table;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return v.result === undefined || v.result === null ? "" : String(v.result);   // formula
  if (typeof v === "object" && "richText" in v) return v.richText.map((p) => p.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);                       // hyperlink
  if (typeof v === "object" && "error" in v) return "";
  return cell.text ?? "";
}
