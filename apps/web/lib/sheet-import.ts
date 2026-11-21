// The office sheet upload (MJ, 2026-11-20, ruling 5: "a way in which we can upload sheet and it
// automatically gets all the products and upload them"). First slice: CSV (UTF-8). Excel .xlsx is
// deferred and logged as a deviation.
//
// This module is pure on purpose: the file is read in the browser, the rules below decide what a row
// means, and the page then calls the office_* functions (H-08) and shows their answer. Nothing here
// writes to a database, so the unit tests cover exactly the code the page runs.
//
// Money is integer paisa (H-10) and is turned from rupees by lib/money.ts toPaisa, the same reader
// every price field uses.

import { toPaisa } from "./money";

/** The column set the office asked for (MJ, 2026-11-20): the first four are required. */
export type SheetColumn = "product" | "group" | "variant" | "size" | "unit" | "sku_code" | "price_rs" | "quantity";

export const SHEET_COLUMNS: readonly SheetColumn[] = [
  "product",
  "group",
  "variant",
  "size",
  "unit",
  "sku_code",
  "price_rs",
  "quantity",
];

export const REQUIRED_COLUMNS: readonly SheetColumn[] = ["product", "group", "variant", "unit"];

// Headings the sheet may use for a column. A heading is compared after lower-casing, trimming,
// collapsing spaces and treating an underscore as a space, so "SKU Code" and "sku_code" are the same.
const HEADINGS: Record<SheetColumn, readonly string[]> = {
  product: ["product", "product name", "item", "item name"],
  group: ["group", "product group", "category"],
  variant: ["variant", "shade", "variant shade", "variant or shade"],
  size: ["size", "size value"],
  unit: ["unit", "uom"],
  sku_code: ["sku code", "code", "sku"],
  price_rs: ["price rs", "price (rs)", "price", "list price rs", "list price"],
  quantity: ["quantity", "qty", "units", "unit count", "unit count pieces"],
};

/** public.sku.unit check: the only units the database accepts. */
export const UNITS = ["ml", "l", "g", "kg", "pack", "piece"] as const;

// public.sku.code check: ^[A-Z0-9][A-Z0-9-]{1,39}$
const CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
const WHOLE = /^\d+$/;
const NUMBER = /^\d+(?:\.\d{1,3})?$/;
// app.parse_lines refuses a received quantity above this.
export const MAX_QUANTITY = 100_000;
// A preview the office can read, and one RPC batch that stays small.
export const MAX_ROWS = 500;
const CODE_LENGTH = 40;
const NAME_MAX = 120;
const VARIANT_MAX = 80;
const GROUP_NAME_MIN = 2;
const GROUP_NAME_MAX = 60;
const BRAND_MAX = 60;
const GENERATED_CODE_HEX = 8;

const heading = (text: string) => text.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");

/** The column a heading names, or null. */
function columnOf(cell: string): SheetColumn | null {
  const h = heading(cell);
  for (const column of SHEET_COLUMNS) {
    if (HEADINGS[column].includes(h)) return column;
  }
  return null;
}

// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks; CRLF, LF or CR alone end a
// line; a UTF-8 byte-order mark is dropped. A quote that is never closed refuses the file: reading on
// would swallow the rest of the sheet into one cell and look like a clean, short file.
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false; // a quoted field has just been closed: only a delimiter or a line break may follow
  let line = 1;
  let quoteLine = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\n" || (ch === "\r" && t[i + 1] !== "\n")) line++;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
      continue;
    }
    if (closed && ch !== "," && ch !== "\n" && ch !== "\r") {
      throw new Error(
        `a quoted field opened on line ${quoteLine} is closed on line ${line} by a quote mark followed by more text; a quote mark inside a field must be doubled`,
      );
    }
    closed = false;
    if (ch === '"' && field === "") {
      quoted = true;
      quoteLine = line;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") {
        i++;
        line++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error(`a quoted field opened on line ${quoteLine} is never closed; fix the quote marks in the file`);
  if (field !== "" || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type SheetRow = {
  /** The line in the file the office sees, for the preview. */
  line: number;
  product: string;
  group: string;
  variant: string;
  size: number | null;
  unit: string;
  code: string | null;
  pricePaisa: number | null;
  /** 0 when the column is empty: the row adds a product and SKU but no stock. */
  quantity: number;
  errors: string[];
};

export type ParsedSheet = { error: string | null; rows: SheetRow[] };

const cell = (row: string[], at: number) => (row[at] ?? "").trim();

/** The header row, the rows under it and every per-row check that needs no database. */
export function parseSheet(text: string): ParsedSheet {
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    return { error: (e as Error).message, rows: [] };
  }
  // The first row with at least two non-empty cells is the header, so a title line above it does not
  // win (the same allowance the salon importer makes).
  const headerAt = table.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
  if (headerAt === -1) return { error: "the file is empty; it needs a header row", rows: [] };
  const header = table[headerAt];
  const at = new Map<SheetColumn, number>();
  header.forEach((c, i) => {
    const column = columnOf(c);
    if (column && !at.has(column)) at.set(column, i);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !at.has(c));
  if (missing.length > 0) {
    return {
      error: `the header is missing ${missing.join(", ")}; the columns are ${SHEET_COLUMNS.join(", ")}`,
      rows: [],
    };
  }
  const data = table.slice(headerAt + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (data.length === 0) return { error: "the sheet has a header but no rows", rows: [] };
  if (data.length > MAX_ROWS) {
    return { error: `the sheet has ${data.length} rows; upload at most ${MAX_ROWS} at a time`, rows: [] };
  }

  const seenCodes = new Map<string, number>();
  const rows = data.map((cells, index) => rowOf(cells, headerAt + 2 + index, at, seenCodes));
  return { error: null, rows };
}

function rowOf(cells: string[], line: number, at: Map<SheetColumn, number>, seenCodes: Map<string, number>): SheetRow {
  const get = (column: SheetColumn) => {
    const i = at.get(column);
    return i === undefined ? "" : cell(cells, i);
  };
  const errors: string[] = [];
  if (cells.length > at.size && cells.slice(at.size).some((c) => (c ?? "").trim() !== "")) {
    errors.push("there are more cells than columns in the header");
  }

  const product = get("product");
  if (product === "") errors.push("the product name is empty");
  else if (product.length > NAME_MAX) errors.push(`the product name is longer than ${NAME_MAX} characters`);

  const group = get("group");
  if (group === "") errors.push("the group is empty");
  else if (group.length < GROUP_NAME_MIN || group.length > GROUP_NAME_MAX) {
    errors.push(`the group name must be ${GROUP_NAME_MIN} to ${GROUP_NAME_MAX} characters`);
  }

  const variant = get("variant");
  if (variant === "") errors.push("the variant (shade) is empty");
  else if (variant.length > VARIANT_MAX) errors.push(`the variant is longer than ${VARIANT_MAX} characters`);

  const unit = get("unit").toLowerCase();
  if (unit === "") errors.push("the unit is empty");
  else if (!(UNITS as readonly string[]).includes(unit)) errors.push(`the unit must be one of ${UNITS.join(", ")}`);

  const sizeText = get("size");
  let size: number | null = null;
  if (sizeText !== "") {
    const n = Number(sizeText);
    if (!NUMBER.test(sizeText) || !(n > 0)) errors.push("the size must be a number above 0, or empty");
    else size = n;
  }

  const codeText = get("sku_code").toUpperCase();
  let code: string | null = null;
  if (codeText !== "") {
    if (!CODE.test(codeText)) {
      errors.push(`the SKU code must be 2 to ${CODE_LENGTH} letters, digits or hyphens, starting with a letter or digit`);
    } else if (seenCodes.has(codeText)) {
      errors.push(`the SKU code ${codeText} is also on line ${seenCodes.get(codeText)}`);
    } else {
      code = codeText;
      seenCodes.set(codeText, line);
    }
  }

  const priceText = get("price_rs");
  let pricePaisa: number | null = null;
  if (priceText !== "") {
    const paisa = toPaisa(priceText);
    if (paisa === null || paisa < 1) errors.push("the price must be rupees, for example 1500 or 1500.50");
    else pricePaisa = paisa;
  }

  const quantityText = get("quantity");
  let quantity = 0;
  if (quantityText !== "") {
    const n = Number(quantityText);
    if (!WHOLE.test(quantityText) || n > MAX_QUANTITY)
      errors.push(`the quantity must be a whole number from 0 to ${MAX_QUANTITY}`);
    else quantity = n;
  }

  return { line, product, group, variant, size, unit, code, pricePaisa, quantity, errors };
}

// ---------------------------------------------------------------- resolving against the catalogue ----

export type CatalogueGroup = { id: string; name: string; active: boolean };
export type CatalogueSku = {
  id: string;
  code: string;
  variant: string;
  unit: string;
  size_value: number | null;
  list_price_paisa: number | null;
  active: boolean;
};
export type CatalogueProduct = {
  product_id: string;
  product_group_id: string;
  group_name: string;
  name: string;
  skus: CatalogueSku[];
};

export type ResolvedRow = {
  row: SheetRow;
  /** The row the page sends to the office_* functions; null when the row cannot be applied. */
  plan: {
    groupId: string;
    groupName: string;
    productId: string;
    productExists: boolean;
    skuId: string;
    skuExists: boolean;
    code: string;
    unit: string;
    variant: string;
    size: number | null;
    pricePaisa: number | null;
    /** The list price recorded now; equal to pricePaisa means no price change is sent. */
    priceNowPaisa: number | null;
    /** 0 when the row carries no unit count. */
    quantity: number;
  } | null;
  errors: string[];
};

// Four FNV-1a 32-bit lanes over the same text: a deterministic 128-bit key from a string. It needs no
// crypto API, so a retry of the same file in the same batch computes the same ids (H-08).
const LANES = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
const FNV_PRIME = 0x01000193;

function keyOf(text: string): string {
  const words = LANES.map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }).join("");
  return `${words.slice(0, 8)}-${words.slice(8, 12)}-${words.slice(12, 16)}-${words.slice(16, 20)}-${words.slice(20)}`;
}

/** The id a row's product or SKU gets when it does not exist yet: the same every time for this batch. */
export const rowKey = (batch: string, kind: "product" | "sku" | "price", line: number) => keyOf(`${batch}:${kind}:${line}`);

// A code the database accepts when the sheet leaves sku_code empty.
function generatedCode(batch: string, line: number, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `SH-${keyOf(`${batch}:code:${line}:${attempt}`).replace(/-/g, "").slice(0, GENERATED_CODE_HEX)}`.toUpperCase();
    if (!taken.has(code)) return code;
  }
  return `SH-${keyOf(`${batch}:code:${line}:last`)
    .replace(/-/g, "")
    .slice(0, CODE_LENGTH - 3)}`.toUpperCase();
}

const lower = (text: string) => text.trim().toLowerCase();
const sizeKey = (size: number | null) => (size === null ? "" : String(size));

/**
 * Matches each row to the catalogue as it is now: an existing group, product (same group and name) and
 * SKU (same product, variant, unit and size, or the code the sheet names). A row that names a group the
 * office has not created is refused, so nothing is invented.
 */
export function resolveSheet(
  rows: readonly SheetRow[],
  groups: readonly CatalogueGroup[],
  products: readonly CatalogueProduct[],
  batch: string,
): ResolvedRow[] {
  const groupByName = new Map<string, CatalogueGroup>();
  for (const g of groups) if (!groupByName.has(lower(g.name))) groupByName.set(lower(g.name), g);
  const productByKey = new Map<string, CatalogueProduct>();
  for (const p of products) productByKey.set(`${p.product_group_id}:${lower(p.name)}`, p);
  const skuByCode = new Map<string, CatalogueSku>();
  const takenCodes = new Set<string>();
  for (const p of products) {
    for (const s of p.skus) {
      skuByCode.set(s.code.toUpperCase(), s);
      takenCodes.add(s.code.toUpperCase());
    }
  }

  // The same product, variant, size and unit twice would make two SKUs (or double the stock of one), so
  // the second row is refused and points at the first.
  const identityLines = new Map<string, number>();

  return rows.map((row) => {
    const errors = [...row.errors];
    const group = groupByName.get(lower(row.group));
    if (!group) {
      errors.push(`there is no product group named "${row.group}"`);
      return { row, plan: null, errors };
    }
    const identity = [group.id, lower(row.product), lower(row.variant), row.unit, sizeKey(row.size)].join("|");
    const first = identityLines.get(identity);
    if (first !== undefined) errors.push(`the same product, variant, size and unit is also on line ${first}`);
    else identityLines.set(identity, row.line);

    const product = productByKey.get(`${group.id}:${lower(row.product)}`);
    const byCode = row.code ? skuByCode.get(row.code) : undefined;
    const byVariant = product?.skus.find(
      (s) => lower(s.variant) === lower(row.variant) && lower(s.unit) === row.unit && sizeKey(s.size_value) === sizeKey(row.size),
    );
    if (byVariant && row.code && row.code !== byVariant.code.toUpperCase()) {
      errors.push(`this product, variant, size and unit is already SKU ${byVariant.code}; use that code or leave sku_code empty`);
    } else if (byCode && !byVariant) {
      // A recorded code on a SKU of another product (or another variant): reusing it would move the SKU.
      errors.push(`the SKU code ${row.code} already belongs to another product`);
    }
    const sku = byVariant ?? byCode;
    if (errors.length > 0) return { row, plan: null, errors };
    const code = sku?.code ?? row.code ?? generatedCode(batch, row.line, takenCodes);
    takenCodes.add(code.toUpperCase());
    return {
      row,
      plan: {
        groupId: group.id,
        groupName: group.name,
        productId: product?.product_id ?? rowKey(batch, "product", row.line),
        productExists: Boolean(product),
        skuId: sku?.id ?? rowKey(batch, "sku", row.line),
        skuExists: Boolean(sku),
        code,
        unit: row.unit,
        variant: row.variant,
        size: row.size,
        pricePaisa: row.pricePaisa,
        priceNowPaisa: sku?.list_price_paisa ?? null,
        quantity: row.quantity,
      },
      errors: [],
    };
  });
}

// ------------------------------------------------------------------------------------ the template ----

/** The downloadable template: UTF-8 CSV, the column set above, two [Dummy] rows (H-04). */
export const CSV_TEMPLATE = [
  SHEET_COLUMNS.join(","),
  "[Dummy] Hair colour,[Dummy] Colour,[Dummy] Shade 5,100,ml,DUMMY-HC-5,1500,12",
  "[Dummy] Shampoo,[Dummy] After care,[Dummy] Regular,400,ml,,650,6",
  "",
].join("\n");

export const TEMPLATE_FILE_NAME = "kiran-sheet-template.csv";

/**
 * The brand label a product created from a row gets. The sheet has no brand column, and the label is
 * Kiran's public one (never a supplier's, doc 07), so the product group's name stands in; the office
 * can change it on the product's card.
 */
export function brandLabelFor(groupName: string): string {
  return groupName.slice(0, BRAND_MAX);
}

// ---------------------------------------------------------------------------------- the batch id ----

/**
 * The first 32 hex characters of a sha-256 digest, formatted as a UUID (version nibble 8 and variant
 * bits 10, the uuid v8 shape), so the value is a valid uuid for the *_client_id columns (H-08).
 */
export function batchUuidFromHex(hex: string): string {
  const h = hex.toLowerCase();
  if (!/^[0-9a-f]{32,}$/.test(h)) throw new Error("32 hex characters are required for a batch id");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * sha-256 of the file bytes (WebCrypto) as the batch id: the same bytes are the same batch and a
 * changed file opens a new one (H-08). The replay guard then survives a re-selection of the same
 * file, which a per-selection random id defeated: only a UI notice stood between the office and a
 * second receipt.
 */
export async function batchIdOf(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source: ArrayBuffer = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return batchUuidFromHex(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
}
