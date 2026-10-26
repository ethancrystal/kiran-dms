// Minimal RFC 4180 CSV parser for "Save As CSV" exports of the owner's sheet. Handles a
// UTF-8 BOM, quoted fields with embedded delimiters, quotes and newlines, CRLF or LF, and
// comma, semicolon or tab delimiters (detected from the early lines).

import { resolveMapping } from "./mapping.ts";

export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  // The delimiter that splits some early line into the most fields (a title line above the
  // header must not decide it).
  const early = t.split(/\r?\n/, 10);
  const counts = [",", ";", "\t"].map((d) => [d, Math.max(...early.map((l) => l.split(d).length))] as const);
  const delim = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Sheets often start with a title line, so the header is the row among the first 20 whose
// cells name the most import fields; failing that, the first row with two non-empty cells.
// Returns its 1-based row number so issues point at the row the owner sees.
export function splitHeader(table: string[][]): { headers: string[]; rows: string[][]; firstDataRow: number } {
  let h = -1, best = 0;
  table.slice(0, 20).forEach((r, i) => {
    const n = Object.keys(resolveMapping(r.map((c) => (c ?? "").trim())).mapping).length;
    if (n > best) { best = n; h = i; }
  });
  if (h === -1) h = table.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
  if (h === -1) return { headers: [], rows: [], firstDataRow: 2 };
  return { headers: table[h].map((c) => (c ?? "").trim()), rows: table.slice(h + 1), firstDataRow: h + 2 };
}
