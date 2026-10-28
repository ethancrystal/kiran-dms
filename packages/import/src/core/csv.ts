// Minimal RFC 4180 CSV parser for "Save As CSV" exports of the owner's sheet. Handles a
// UTF-8 BOM, quoted fields with embedded delimiters, quotes and newlines, CRLF, LF or CR
// alone, and comma, semicolon or tab delimiters (detected from the early lines).

import { resolveMapping, strongMatches } from "./mapping.ts";

export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  // The delimiter that splits some early line into the most fields (a title line above the
  // header must not decide it). CR alone is a line break too (L-0116 P0-02 O1).
  const early = t.split(/\r\n|\r|\n/, 10);
  const counts = [",", ";", "\t"].map((d) => [d, Math.max(...early.map((l) => l.split(d).length))] as const);
  const delim = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;   // a quoted field has just been closed: only a delimiter or a line break may follow
  let line = 1;
  let quoteLine = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    // Count LF, and CR not followed by LF, so a CR-only file names the right line (L-0116 P0-02 O1).
    if (ch === "\n" || (ch === "\r" && t[i + 1] !== "\n")) line++;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
      } else field += ch;
      continue;
    }
    if (closed && ch !== delim && ch !== "\n" && ch !== "\r") {
      // Text after a closing quote ("Corner shop ... 12" mirror) means the quote that opened the
      // field was closed by a stray quote, possibly lines later, and every row in between was
      // swallowed into one cell. RFC 4180 does not allow it: refuse the file rather than read
      // fewer rows and say CLEAN (L-0116 P0-02 D1). The message never quotes the cell (H-03).
      throw new Error(`a quoted field opened on line ${quoteLine} is closed on line ${line} by a quote mark that is followed by more text; ` +
        `a quote mark inside a field must be doubled (""), or the field must not start with a quote mark: fix the quote marks in the file`);
    }
    closed = false;
    if (ch === '"' && field === "") { quoted = true; quoteLine = line; }
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") { i++; line++; }
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  // A quote opened and never closed would swallow every later line into one cell and the run
  // would still look clean with fewer rows (council audit 2026-10-27, finding 9): refuse the file.
  if (quoted) throw new Error(`a quoted field opened on line ${quoteLine} is never closed; fix the quote marks in the file`);
  if (field !== "" || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

// Sheets often start with a title line, so the header is chosen among the first 20 rows. A row
// qualifies when it names at least two import fields (counting the columns an explicit
// --mapping names). Among those, the row with the most headings matched exactly (a whole
// heading such as "Salon Name", or a column --mapping names) wins, then the row naming the
// most fields. A row matched only by headings that START with a known word ("Salon Colour",
// "Block 13") is usually a data row, so it never beats a row of plain headings; dryRun refuses
// it as the header unless --mapping confirms it (L-0116 P0-02 D4). One match is not enough: a
// title such as "Salon list 2026", or a data row holding the word "Parlour", would otherwise win
// (L-0085 P0-02 D1, FP3). Failing that, the first row with two non-empty cells. Returns its
// 1-based row number plus one, so issues point at the row the owner sees.
export function splitHeader(table: string[][], explicit: Record<string, string> = {}): { headers: string[]; rows: string[][]; firstDataRow: number } {
  let h = -1, bestStrong = -1, bestTotal = 0;
  table.slice(0, 20).forEach((r, i) => {
    const m = resolveMapping(r.map((c) => (c ?? "").trim()), explicit);
    const total = Object.keys(m.mapping).length + m.extraPhones.length;
    if (total < 2) return;
    const strong = strongMatches(m);
    if (strong > bestStrong || (strong === bestStrong && total > bestTotal)) { bestStrong = strong; bestTotal = total; h = i; }
  });
  if (h === -1) h = table.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
  if (h === -1) return { headers: [], rows: [], firstDataRow: 2 };
  return { headers: table[h].map((c) => (c ?? "").trim()), rows: table.slice(h + 1), firstDataRow: h + 2 };
}
