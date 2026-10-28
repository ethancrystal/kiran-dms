// Dry-run validation of salon rows (P0-02, SAL-10). Pure: takes a parsed table, returns a
// report. Nothing here reads files or writes to a database; the real import is P1-02.
//
// Errors block the import ("not clean"); warnings are imported with a flag for the manager.
// The definitions are in docs/runbooks/excel-import-dry-run.md and must stay in sync (H-25).

import { columnLetter, isHeaderWords, resolveMapping, strongMatches, type Field, type Mapping } from "./mapping.ts";
import {
  excelError, formatRupees, keyOf, mapSalonType, maskPhone, normalizePhone, parseChairs, parseGeo, parsePaisa,
  splitPhones, type SalonType,
} from "./normalize.ts";

export type Issue = { row: number; field: Field | "row"; message: string };

export type SalonCandidate = {
  row: number;
  name: string;
  type: SalonType;
  area: string;
  address: string | null;
  phones: string[];            // E.164; the first is the primary contact
  contactName: string | null;
  chairs: number | null;
  geo: { lat: number; lng: number } | null;
  openingBalancePaisa: bigint; // becomes an "opening invoice" row in P1-02 (doc 11 risks)
  notes: string | null;
  ref: string | null;
  source: "excel_import";
};

export type DryRunReport = {
  clean: boolean;
  mapping: Mapping;            // field -> column, as printed: "Header" when it is header vocabulary, else "column C"
  extraPhones: string[];       // further phone columns, printed the same way
  unmappedHeaders: string[];   // ignored columns, printed the same way
  fatal: string[];             // file-level problems (missing required column, bad mapping)
  headerRow: number;           // spreadsheet row taken as the header; rows above it are not read
  rowsRead: number;            // non-empty data rows
  rowsValid: number;           // rows with no error
  errors: Issue[];
  warnings: Issue[];
  areas: Array<{ area: string; salons: number; known: boolean | null }>;
  types: Partial<Record<SalonType, number>>;
  balances: { salonsWithBalance: number; totalPaisa: string; creditBalances: number };
  candidates: SalonCandidate[];
};

export type DryRunOptions = {
  mapping?: Record<string, string>;   // field -> header, overrides the guess
  knownAreas?: string[];              // the area list (P0-03); unknown areas become warnings
  firstDataRow?: number;              // spreadsheet row number of rows[0] (default 2)
};

export function dryRun(headers: string[], rows: string[][], opts: DryRunOptions = {}): DryRunReport {
  const m = resolveMapping(headers, opts.mapping);
  const headerRow = (opts.firstDataRow ?? 2) - 1;
  // The header row is confirmed only when at least two of its headings are matched exactly or
  // named by --mapping. A row matched only by headings that start with a known word ("Salon
  // Colour" -> name, "Block 13" -> area) or by a phone word is likely a data row on a sheet
  // with no header row: it and every row above it would be dropped unchecked, and its cells
  // would be printed as headings. Such a row is refused, and none of its cells is printed: every
  // heading is shown by column letter (L-0116 P0-02 D4).
  const confirmed = strongMatches(m) >= 2;
  // Two columns with the same heading (case, spacing and punctuation ignored): the mapping can
  // claim only one of them, so the other would be dropped unchecked, its phones left out of the
  // CTL-18 duplicate check, while the run still said CLEAN (council audit 2026-10-27, finding 8).
  const seen = new Map<string, number[]>();
  headers.forEach((h, i) => { if (h.trim() !== "") seen.set(keyOf(h), [...(seen.get(keyOf(h)) ?? []), i]); });
  const duplicates = [...seen.values()].filter((cols) => cols.length > 1).map((cols) => {
    const h = headers[cols[0]];
    const name = confirmed && isHeaderWords(h) ? `"${h}"` : "a heading";
    return `${name} heads more than one column (columns ${cols.map(columnLetter).join(", ")}): rename them so each column has its own heading`;
  });
  const fatal = [
    ...duplicates,
    ...m.problems,
    ...m.missingRequired.map((f) => `no column for required field "${f}" (add one, or pass a mapping)`),
    ...(!confirmed && m.missingRequired.length === 0
      ? [`row ${headerRow} was taken as the header, but fewer than two of its headings are ones the tool knows exactly (such as "Salon Name", "Area", "Mobile"); ` +
         `it may be a data row on a sheet with no header row: add a header row with plain headings, or name the columns with --mapping`]
      : []),
  ];
  const col = (f: Field) => (m.mapping[f] === undefined ? -1 : headers.indexOf(m.mapping[f]!));
  const idx = Object.fromEntries((Object.keys(m.mapping) as Field[]).map((f) => [f, col(f)])) as Partial<Record<Field, number>>;
  const get = (r: string[], f: Field) => (idx[f] === undefined || idx[f]! < 0 ? "" : (r[idx[f]!] ?? "").trim());
  const extraIdx = m.extraPhones.map((h) => headers.indexOf(h));
  const label = (h: string) => ((confirmed && isHeaderWords(h)) || Object.values(opts.mapping ?? {}).includes(h) ? `"${h}"` : `column ${columnLetter(headers.indexOf(h))}`);

  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const candidates: SalonCandidate[] = [];
  const known = opts.knownAreas ? new Set(opts.knownAreas.map(keyOf)) : null;
  let rowsRead = 0;

  if (fatal.length === 0) {
    rows.forEach((r, i) => {
      const rowNo = i + (opts.firstDataRow ?? 2);   // the row number the owner sees in Excel
      if (r.every((c) => (c ?? "").trim() === "")) return;
      rowsRead++;
      const err = (field: Issue["field"], message: string) => errors.push({ row: rowNo, field, message });
      const warn = (field: Issue["field"], message: string) => warnings.push({ row: rowNo, field, message });
      const before = errors.length;

      // A cell holding an Excel error (#N/A, #REF!, ...) or a formula with no saved result is
      // an error in its own right, never read as text, zero or blank (L-0085 P0-02 D2).
      const bad = new Set<Field>();
      for (const f of Object.keys(idx) as Field[]) {
        const e = excelError(get(r, f));
        if (e) { err(f, e); bad.add(f); }
      }
      const extraCells = extraIdx.map((c) => (r[c] ?? "").trim());
      for (const c of extraCells) { const e = excelError(c); if (e) { err("phone", e); bad.add("phone"); } }
      const val = (f: Field) => (bad.has(f) ? "" : get(r, f));

      const name = val("name");
      if (bad.has("name")) { /* reported above */ }
      else if (name === "") err("name", "salon name is empty");
      else if (name.length < 2 || name.length > 120) err("name", "salon name must be 2 to 120 characters");

      const area = val("area");
      if (bad.has("area")) { /* reported above */ }
      else if (area === "") err("area", "area is empty (every salon needs an area to get a territory, SAL-02)");
      else if (known && !known.has(keyOf(area))) warn("area", "area is not in the area list");

      const type = mapSalonType(val("type"));
      if (type.ok && type.warning) warn("type", type.warning);

      const phoneCells = bad.has("phone") ? [] : [get(r, "phone"), ...extraCells];
      const phones: string[] = [];
      for (const p of phoneCells.flatMap(splitPhones)) {
        const n = normalizePhone(p);
        if (!n.ok) { err("phone", n.error); continue; }
        if (n.warning) warn("phone", n.warning);
        if (!phones.includes(n.value)) phones.push(n.value);
      }
      if (!bad.has("phone") && phoneCells.every((c) => c === "")) warn("phone", "no phone: the salon cannot be verified (CTL-09) until one is added");

      const chairs = parseChairs(val("chairs"));
      if (!chairs.ok) err("chairs", chairs.error);

      const geo = bad.has("lat") || bad.has("lng") ? { ok: true as const, value: null } : parseGeo(get(r, "lat"), get(r, "lng"));
      if (!geo.ok) err("lat", geo.error);
      else if (geo.warning) warn("lat", geo.warning);

      const bal = parsePaisa(val("opening_balance"));
      if (!bal.ok) err("opening_balance", bal.error);
      else if (bal.value < 0n) warn("opening_balance", "negative balance (the salon is in credit): needs a manager decision before go-live");

      const contact = val("contact_name");
      if (contact.length > 120) err("contact_name", "contact name is longer than 120 characters");

      if (errors.length === before) {
        candidates.push({
          row: rowNo, name, type: type.ok ? type.value : "other", area,
          address: val("address") || null, phones, contactName: contact || null,
          chairs: chairs.ok ? chairs.value : null, geo: geo.ok ? geo.value : null,
          openingBalancePaisa: bal.ok ? bal.value : 0n,
          notes: val("notes") || null, ref: val("ref") || null, source: "excel_import",
        });
      }
    });

    // Cross-row checks. The same phone on more than one salon is flagged (CTL-18); the same
    // name in the same area is a likely duplicate row. Both import with a warning.
    const byPhone = new Map<string, number[]>();
    const byNameArea = new Map<string, number[]>();
    for (const c of candidates) {
      for (const p of c.phones) byPhone.set(p, [...(byPhone.get(p) ?? []), c.row]);
      const k = keyOf(c.name) + "|" + keyOf(c.area);
      byNameArea.set(k, [...(byNameArea.get(k) ?? []), c.row]);
    }
    for (const [p, rs] of byPhone) if (rs.length > 1) for (const row of rs) warnings.push({ row, field: "phone", message: `phone ${maskPhone(p)} is on ${rs.length} salons (rows ${rs.join(", ")}); flagged per CTL-18` });
    for (const rs of byNameArea.values()) if (rs.length > 1) for (const row of rs) warnings.push({ row, field: "row", message: `same name and area as rows ${rs.filter((x) => x !== row).join(", ")}: possible duplicate` });
    warnings.sort((a, b) => a.row - b.row);
  }

  const areaCount = new Map<string, { area: string; salons: number }>();
  for (const c of candidates) {
    const k = keyOf(c.area);
    const e = areaCount.get(k) ?? { area: c.area, salons: 0 };
    e.salons++;
    areaCount.set(k, e);
  }
  const types: Partial<Record<SalonType, number>> = {};
  for (const c of candidates) types[c.type] = (types[c.type] ?? 0) + 1;
  const withBal = candidates.filter((c) => c.openingBalancePaisa !== 0n);
  const total = candidates.reduce((s, c) => s + c.openingBalancePaisa, 0n);

  return {
    clean: fatal.length === 0 && errors.length === 0 && rowsRead > 0,
    mapping: Object.fromEntries(Object.entries(m.mapping).map(([f, h]) => [f, label(h!)])) as Mapping,
    extraPhones: m.extraPhones.map(label),
    unmappedHeaders: m.unmappedHeaders.map(label),
    fatal: rowsRead === 0 && fatal.length === 0 ? ["the file has no data rows"] : fatal,
    headerRow,
    rowsRead,
    rowsValid: candidates.length,
    errors,
    warnings,
    areas: [...areaCount.entries()].map(([k, v]) => ({ ...v, known: known ? known.has(k) : null }))
      .sort((a, b) => b.salons - a.salons || a.area.localeCompare(b.area)),
    types,
    balances: { salonsWithBalance: withBal.length, totalPaisa: total.toString(), creditBalances: withBal.filter((c) => c.openingBalancePaisa < 0n).length },
    candidates,
  };
}

// Human-readable report. It never prints salon names, contact names, addresses or full
// phone numbers: errors point at spreadsheet rows, so the report is safe to read aloud or
// paste into a ticket (H-03). Candidates are not printed at all.
export function formatReport(r: DryRunReport, opts: { maxIssues?: number } = {}): string {
  const max = opts.maxIssues ?? 200;
  const out: string[] = [];
  out.push(`Kiran salon import: DRY RUN (nothing was written anywhere)`);
  out.push(``);
  out.push(`Result: ${r.clean ? "CLEAN: no errors; ready for the P1-02 import" : "NOT CLEAN: fix the errors below and run again"}`);
  out.push(`Rows read: ${r.rowsRead}   valid: ${r.rowsValid}   errors: ${r.errors.length}   warnings: ${r.warnings.length}`);
  out.push(``);
  out.push(`Header row: ${r.headerRow}${r.headerRow > 1 ? ` (rows 1 to ${r.headerRow - 1} above it are not read)` : ""}`);
  out.push(`Column mapping:`);
  for (const [f, h] of Object.entries(r.mapping)) out.push(`  ${f.padEnd(16)} <- ${h}`);
  for (const h of r.extraPhones) out.push(`  ${"phone (also)".padEnd(16)} <- ${h}`);
  if (r.unmappedHeaders.length) out.push(`  (ignored columns: ${r.unmappedHeaders.join(", ")})`);
  if (r.fatal.length) { out.push(``); out.push(`File problems:`); for (const f of r.fatal) out.push(`  - ${f}`); }
  const list = (title: string, xs: Issue[]) => {
    if (!xs.length) return;
    out.push(``);
    out.push(`${title} (${xs.length}):`);
    for (const x of xs.slice(0, max)) out.push(`  row ${String(x.row).padStart(5)}  ${x.field.padEnd(16)} ${x.message}`);
    if (xs.length > max) out.push(`  … ${xs.length - max} more (use --json for the full list)`);
  };
  list("Errors", r.errors);
  list("Warnings", r.warnings);
  if (r.areas.length) {
    out.push(``);
    out.push(`Areas (${r.areas.length}), for the territory draft (P0-03):`);
    for (const a of r.areas) out.push(`  ${String(a.salons).padStart(5)}  ${a.area}${a.known === false ? "   [not in area list]" : ""}`);
  }
  if (Object.keys(r.types).length) {
    out.push(``);
    out.push(`Salon types: ${Object.entries(r.types).map(([t, n]) => `${t} ${n}`).join(", ")}`);
  }
  out.push(`Opening balances: ${r.balances.salonsWithBalance} salons, total ${formatRupees(BigInt(r.balances.totalPaisa))}` +
    (r.balances.creditBalances ? `, ${r.balances.creditBalances} in credit` : ""));
  return out.join("\n");
}

// The JSON report carries the same masked facts as the text report, never the candidates.
export function reportJson(r: DryRunReport): string {
  const { candidates, ...rest } = r;
  return JSON.stringify({ ...rest, candidates: candidates.length }, null, 2);
}
