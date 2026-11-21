import { describe, expect, it } from "vitest";
import {
  type CatalogueGroup,
  type CatalogueProduct,
  CSV_TEMPLATE,
  MAX_QUANTITY,
  type ParsedSheet,
  parseCsv,
  parseSheet,
  resolveSheet,
  rowKey,
} from "./sheet-import";

// The parser and the row rules the office sheet upload runs in the browser (MJ, 2026-11-20, ruling 5).
// No database is touched: parseSheet decides what a file says, resolveSheet matches it to the catalogue
// the page has just read, and the page then calls the office_* functions and shows their answer.

const HEADER = "product,group,variant,size,unit,sku_code,price_rs,quantity";
const sheet = (...lines: string[]) => [HEADER, ...lines].join("\n");

const errorsOf = (parsed: ParsedSheet) => parsed.rows.flatMap((r) => r.errors);

describe("parseCsv", () => {
  it("keeps a comma, a doubled quote and a line break inside a quoted field", () => {
    const rows = parseCsv('a,"b,c","d""e","f\ng"\r\n1,2,3,4');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e', "f\ng"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("reads CRLF, LF and a CR alone as line breaks and drops the byte-order mark", () => {
    expect(parseCsv("\uFEFFa,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("refuses a quote that is never closed instead of reading the rest as one cell", () => {
    expect(() => parseCsv('a,"unclosed\nb,c')).toThrow(/never closed/);
  });

  it("refuses text after a closing quote, which would swallow the rows between", () => {
    expect(() => parseCsv('a,"b" c\n1,2')).toThrow(/quote mark inside a field must be doubled/);
  });
});

describe("parseSheet", () => {
  it("accepts the template: two [Dummy] rows, no errors", () => {
    const parsed = parseSheet(CSV_TEMPLATE);
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(errorsOf(parsed)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      product: "[Dummy] Hair colour",
      group: "[Dummy] Colour",
      variant: "[Dummy] Shade 5",
      size: 100,
      unit: "ml",
      code: "DUMMY-HC-5",
      pricePaisa: 150_000,
      quantity: 12,
    });
    expect(parsed.rows[1].code).toBeNull();
    expect(parsed.rows[1].pricePaisa).toBe(65_000);
    expect(parsed.rows[1].quantity).toBe(6);
  });

  it("names a missing required column and lists the column set", () => {
    const parsed = parseSheet("product,group,size\n[Dummy] A,[Dummy] B,100");
    expect(parsed.error).toMatch(/missing variant, unit/);
    expect(parsed.rows).toEqual([]);
  });

  it("takes optional columns by their common headings and ignores their order", () => {
    const parsed = parseSheet(
      ["qty,SKU Code,Unit,Shade,Group,Product,Price (Rs),Size", "3,abc-1,ML,[Dummy] S,[Dummy] G,[Dummy] P,100,50"].join("\n"),
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows[0]).toMatchObject({ code: "ABC-1", unit: "ml", quantity: 3, pricePaisa: 10_000, size: 50 });
  });

  it("reports an empty product name, an unknown unit and a bad size on the row", () => {
    const parsed = parseSheet(sheet(",Colour,Shade 1,abc,litre,,,"));
    expect(parsed.error).toBeNull();
    expect(parsed.rows[0].errors).toEqual([
      "the product name is empty",
      "the unit must be one of ml, l, g, kg, pack, piece",
      "the size must be a number above 0, or empty",
    ]);
  });

  it("refuses a quantity that is not a whole number, is negative or is above the limit", () => {
    for (const bad of ["1.5", "-2", "abc", String(MAX_QUANTITY + 1)]) {
      const parsed = parseSheet(sheet(`[Dummy] P,Colour,Shade 1,100,ml,,,${bad}`));
      expect(parsed.rows[0].errors.join(" "), bad).toMatch(/quantity must be a whole number/);
    }
    expect(parseSheet(sheet("[Dummy] P,Colour,Shade 1,100,ml,")).rows[0].quantity).toBe(0);
  });

  it("refuses a price that is not rupees", () => {
    // A comma inside a price has to be quoted in CSV; both readings are refused.
    for (const bad of ['"1,500"', "0", "-5", "1.234"]) {
      const parsed = parseSheet(sheet(`[Dummy] P,Colour,Shade 1,100,ml,,${bad},`));
      expect(parsed.rows[0].errors.join(" "), bad).toMatch(/price must be rupees/);
    }
  });

  it("refuses a SKU code used twice in the file and names the first line", () => {
    const parsed = parseSheet(sheet("[Dummy] A,Colour,Shade 1,100,ml,SAME-1,,", "[Dummy] B,Colour,Shade 2,100,ml,SAME-1,,"));
    expect(parsed.rows[0].errors).toEqual([]);
    expect(parsed.rows[1].errors.join(" ")).toMatch(/SKU code SAME-1 is also on line 2/);
  });

  it("refuses a SKU code that breaks the database pattern", () => {
    const parsed = parseSheet(sheet("[Dummy] P,Colour,Shade 1,100,ml,abc_1,,"));
    expect(parsed.rows[0].errors.join(" ")).toMatch(/SKU code must be 2 to 40/);
  });

  it("refuses more cells than the header names", () => {
    const parsed = parseSheet(sheet("[Dummy] P,Colour,Shade 1,100,ml,,,5,extra"));
    expect(parsed.rows[0].errors.join(" ")).toMatch(/more cells than columns/);
  });

  it("refuses a sheet with a header but no rows, and one over the row limit", () => {
    expect(parseSheet(HEADER).error).toMatch(/no rows/);
    const many = Array.from({ length: 501 }, () => "[Dummy] P,Colour,Shade 1,100,ml,,,");
    expect(parseSheet(sheet(...many)).error).toMatch(/at most 500/);
  });

  it("finds the header under a title line", () => {
    const parsed = parseSheet(`[Dummy] stock list\n${sheet("[Dummy] P,Colour,Shade 1,100,ml,,,")}`);
    expect(parsed.error).toBeNull();
    expect(parsed.rows[0].line).toBe(3);
  });
});

const groups: CatalogueGroup[] = [{ id: "group-1", name: "[Dummy] Colour", active: true }];
const catalogue: CatalogueProduct[] = [
  {
    product_id: "product-1",
    product_group_id: "group-1",
    group_name: "[Dummy] Colour",
    name: "[Dummy] Hair colour",
    skus: [
      {
        id: "sku-1",
        code: "DUMMY-HC-5",
        variant: "[Dummy] Shade 5",
        unit: "ml",
        size_value: 100,
        list_price_paisa: 150_000,
        active: true,
      },
    ],
  },
];

describe("resolveSheet", () => {
  const batch = "00000000-0000-4000-8000-000000000000";

  it("reports a group the office has not created", () => {
    const parsed = parseSheet(sheet("[Dummy] P,Missing group,Shade 1,100,ml,,,"));
    const [resolved] = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(resolved.plan).toBeNull();
    expect(resolved.errors.join(" ")).toMatch(/no product group named "Missing group"/);
  });

  it("matches an existing product and SKU and leaves an equal price alone", () => {
    const parsed = parseSheet(sheet("[Dummy] Hair colour,[Dummy] Colour,[Dummy] Shade 5,100,ml,DUMMY-HC-5,1500,4"));
    const [resolved] = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(resolved.errors).toEqual([]);
    expect(resolved.plan).toMatchObject({
      productId: "product-1",
      productExists: true,
      skuId: "sku-1",
      skuExists: true,
      code: "DUMMY-HC-5",
      pricePaisa: 150_000,
      priceNowPaisa: 150_000,
      quantity: 4,
    });
  });

  it("plans a new product and SKU with stable ids and a generated code", () => {
    const parsed = parseSheet(sheet("[Dummy] New product,[Dummy] Colour,[Dummy] Shade 7,200,ml,,900,2"));
    const [first] = resolveSheet(parsed.rows, groups, catalogue, batch);
    const [again] = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(first.errors).toEqual([]);
    expect(first.plan).toMatchObject({ productExists: false, skuExists: false, priceNowPaisa: null });
    expect(first.plan?.code).toMatch(/^SH-[0-9A-F]{8}$/);
    // A retry of the same file in the same batch sends the same ids and code, so nothing doubles (H-08).
    expect(again.plan).toEqual(first.plan);
    expect(first.plan?.productId).toBe(rowKey(batch, "product", 2));
    expect(first.plan?.skuId).toBe(rowKey(batch, "sku", 2));
    expect(rowKey(batch, "product", 2)).not.toBe(rowKey(batch, "sku", 2));
  });

  it("refuses the same product, variant, size and unit twice", () => {
    const parsed = parseSheet(
      sheet("[Dummy] P,[Dummy] Colour,Shade 1,100,ml,AA-1,,", "[Dummy] P,[Dummy] Colour,Shade 1,100,ml,AA-2,,"),
    );
    const resolved = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(resolved[1].errors.join(" ")).toMatch(/same product, variant, size and unit is also on line 2/);
    expect(resolved[1].plan).toBeNull();
  });

  it("refuses a recorded code that belongs to another product", () => {
    const parsed = parseSheet(sheet("[Dummy] Other,[Dummy] Colour,[Dummy] Shade 1,100,ml,DUMMY-HC-5,,"));
    const [resolved] = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(resolved.errors.join(" ")).toMatch(/SKU code DUMMY-HC-5 already belongs to another product/);
  });

  it("refuses a different code for an existing variant instead of renaming its SKU", () => {
    const parsed = parseSheet(sheet("[Dummy] Hair colour,[Dummy] Colour,[Dummy] Shade 5,100,ml,DUMMY-HC-9,,"));
    const [resolved] = resolveSheet(parsed.rows, groups, catalogue, batch);
    expect(resolved.errors.join(" ")).toMatch(/already SKU DUMMY-HC-5/);
  });
});
