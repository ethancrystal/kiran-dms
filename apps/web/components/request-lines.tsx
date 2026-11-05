"use client";

// Product lines of a request (D-34; migration 20261105150000): a SKU and a whole quantity per line,
// never a price. The database prices a request when the office converts it (the salon's own price,
// else the list price) and refuses any price sent with a line. Used by the rep's order card form, the
// rep's card edit and the salon's request edit.

import { db, rows } from "@/lib/rpc";

const SKU_LIMIT = 1000;

/**
 * The products a rep may put on a card: active, priced SKUs, read under RLS (reps read active product
 * and SKU rows). No price is shown: the salon's price is the office's to quote.
 */
export async function repProductOptions(): Promise<PickOption[]> {
  const list = await rows<{ id: string; code: string; variant: string; product: { name: string } | null }>(
    db()
      .from("sku")
      .select("id, code, variant, product:product_id(name)")
      .eq("active", true)
      .not("list_price_paisa", "is", null)
      .order("code")
      .limit(SKU_LIMIT),
  );
  return list.map((k) => ({ id: k.id, label: `${k.code} · ${k.product?.name ?? "Product"} ${k.variant}` }));
}

/** One line as typed. */
export type PickLine = { key: string; skuId: string; qty: string };
/** A product the picker offers. */
export type PickOption = { id: string; label: string };

const MAX_LINES = 50; // app.assert_card_lines: a request has 1 to 50 lines.
const QTY_MAX = 10_000;

export const newPick = (skuId = "", qty = "1"): PickLine => ({ key: crypto.randomUUID(), skuId, qty });

/**
 * The lines as the request functions take them ([{sku_id, qty}]), or null when no product is chosen.
 * Throws a message for the page when a line is half filled.
 */
export function picksPayload(lines: PickLine[]): Array<{ sku_id: string; qty: number }> | null {
  const chosen = lines.filter((l) => l.skuId);
  if (chosen.length === 0) return null;
  if (chosen.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1 || Number(l.qty) > QTY_MAX)) {
    throw new Error(`Enter a whole quantity from 1 to ${QTY_MAX} on every line.`);
  }
  return chosen.map((l) => ({ sku_id: l.skuId, qty: Number(l.qty) }));
}

/** The picker. `name` keeps the labels unique on a page with more than one picker. */
export function LinePicker({
  name,
  options,
  lines,
  onChange,
}: {
  name: string;
  options: PickOption[];
  lines: PickLine[];
  onChange: (lines: PickLine[]) => void;
}) {
  const set = (key: string, change: Partial<PickLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));
  return (
    <>
      {lines.map((l, n) => (
        <fieldset key={l.key} className="inline-form">
          <legend>
            {name} line {n + 1}
          </legend>
          <label htmlFor={`${name}-sku-${l.key}`}>
            {name} product {n + 1}
          </label>
          <select id={`${name}-sku-${l.key}`} value={l.skuId} onChange={(e) => set(l.key, { skuId: e.target.value })}>
            <option value="">No product</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <label htmlFor={`${name}-qty-${l.key}`}>
            {name} quantity {n + 1}
          </label>
          <input
            id={`${name}-qty-${l.key}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={QTY_MAX}
            step={1}
            value={l.qty}
            onChange={(e) => set(l.key, { qty: e.target.value })}
          />
          {lines.length > 1 && (
            <button type="button" className="inline link" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
              Remove {name.toLowerCase()} line {n + 1}
            </button>
          )}
        </fieldset>
      ))}
      {lines.length < MAX_LINES && (
        <button type="button" className="inline" onClick={() => onChange([...lines, newPick()])}>
          Add a {name.toLowerCase()} line
        </button>
      )}
    </>
  );
}
