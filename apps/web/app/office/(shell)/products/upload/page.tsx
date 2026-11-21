"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { rupees } from "@/lib/money";
import { db, messageOf, mySession, rows, rpc, type Session } from "@/lib/rpc";
import {
  brandLabelFor,
  type CatalogueGroup,
  type CatalogueProduct,
  CSV_TEMPLATE,
  parseSheet,
  type ResolvedRow,
  resolveSheet,
  rowKey,
  SHEET_COLUMNS,
  TEMPLATE_FILE_NAME,
} from "@/lib/sheet-import";

// Upload a sheet (MJ, 2026-11-20, ruling 5): the office uploads a CSV of products and unit counts and
// the products, SKUs, prices and stock are recorded. First slice: CSV (UTF-8); Excel .xlsx is deferred
// and logged as a deviation.
//
// The browser parses and checks the file (lib/sheet-import.ts); this page then writes through the
// functions that already exist and shows their answer, never a made-up success:
//   app.office_upsert_product, app.office_upsert_sku, app.office_set_sku_price (H-08),
//   app.office_receive_stock into the warehouse for the quantities.
// One client id for the whole file and ids derived from it, so a retry of the same file changes
// nothing twice (H-08): a receipt replays, a price replays, an upsert lands on the same row.

const PRICE_REASON = "sheet upload";
const RECEIPT_REASON = "sheet upload";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const NO_ERRORS = 0;

type Warehouse = { id: string; name: string };
type Outcome = { lines: string[]; error: string | null };

const sizeText = (size: number | null, unit: string) => (size === null ? unit : `${size} ${unit}`);

export default function UploadSheet() {
  const [me, setMe] = useState<Session | null>(null);
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [groups, setGroups] = useState<CatalogueGroup[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedRow[]>([]);
  // One id per file: every id the apply sends is derived from it, so a retry of the same file is the
  // same write (H-08). It changes only when another file is chosen.
  const [batch, setBatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Map<number, Outcome>>(new Map());
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, p, g, w] = await Promise.all([
        mySession(),
        rpc<CatalogueProduct[]>("office_catalogue"),
        rows<CatalogueGroup>(db().from("product_group").select("id, name, active").order("name")),
        rows<Warehouse>(db().from("stock_location").select("id, name").eq("active", true).eq("kind", "warehouse").order("name")),
      ]);
      setMe(s);
      setProducts(p ?? []);
      setGroups(g);
      setWarehouses(w);
      setWarehouseId((current) => current || w[0]?.id || "");
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const wrongRole = me !== null && me.role !== "owner" && me.role !== "manager";

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    setNotice(null);
    setOutcomes(new Map());
    setApplied(false);
    setResolved([]);
    setFileName(file?.name ?? "");
    setBatch("");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("The file is over 2 MB; split the sheet and upload the parts.");
      return;
    }
    const parsed = parseSheet(await file.text());
    if (parsed.error) {
      setFileError(parsed.error);
      return;
    }
    const next = crypto.randomUUID();
    setBatch(next);
    setResolved(resolveSheet(parsed.rows, groups, products, next));
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = TEMPLATE_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  const withErrors = resolved.filter((r) => r.errors.length > 0).length;
  const stockRows = resolved.filter((r) => (r.plan?.quantity ?? 0) > 0).length;
  const canApply =
    !busy &&
    !applied &&
    resolved.length > 0 &&
    withErrors === NO_ERRORS &&
    (stockRows === 0 || warehouseId !== "") &&
    me !== null &&
    !wrongRole;

  const apply = async () => {
    setBusy(true);
    setNotice(null);
    const done = new Map<number, Outcome>();
    const received: { sku_id: string; qty: number }[] = [];
    let addedProducts = 0;
    let addedSkus = 0;
    let changedPrices = 0;
    for (const r of resolved) {
      const plan = r.plan;
      if (!plan) continue;
      const lines: string[] = [];
      try {
        if (plan.productExists) lines.push("product already recorded");
        else {
          await rpc("office_upsert_product", {
            p_id: plan.productId,
            p_product_group_id: plan.groupId,
            p_brand_label: brandLabelFor(plan.groupName),
            p_name: r.row.product,
            p_active: true,
            p_description: null,
            p_image_path: null,
          });
          lines.push("product added");
          addedProducts++;
        }
        if (plan.skuExists) lines.push(`SKU ${plan.code} already recorded`);
        else {
          await rpc("office_upsert_sku", {
            p_id: plan.skuId,
            p_product_id: plan.productId,
            p_code: plan.code,
            p_variant: plan.variant,
            p_unit: plan.unit,
            p_size_value: plan.size,
            p_units_per_carton: null,
            p_barcode: null,
            p_active: true,
          });
          lines.push(`SKU ${plan.code} added`);
          addedSkus++;
        }
        if (plan.pricePaisa !== null && plan.pricePaisa !== plan.priceNowPaisa) {
          await rpc("office_set_sku_price", {
            p_client_id: rowKey(batch, "price", r.row.line),
            p_sku_id: plan.skuId,
            p_price_paisa: plan.pricePaisa,
            p_reason: PRICE_REASON,
          });
          lines.push(`price set to ${rupees(plan.pricePaisa)}`);
          changedPrices++;
        } else if (plan.pricePaisa !== null) lines.push("price unchanged");
        done.set(r.row.line, { lines, error: null });
        if (plan.quantity > 0) received.push({ sku_id: plan.skuId, qty: plan.quantity });
      } catch (e) {
        done.set(r.row.line, { lines, error: messageOf(e) });
      }
    }
    if (received.length > 0) {
      const warehouse = warehouses.find((w) => w.id === warehouseId);
      const where = warehouse?.name ?? "the warehouse";
      try {
        const answer = await rpc<{ replay?: boolean; units?: number }>("office_receive_stock", {
          p_client_id: batch,
          p_location_id: warehouseId,
          p_lines: received,
          p_reason: RECEIPT_REASON,
        });
        for (const r of resolved) {
          const qty = r.plan?.quantity ?? 0;
          if (qty === 0) continue;
          const outcome = done.get(r.row.line);
          if (!outcome || outcome.error) continue;
          outcome.lines.push(
            answer?.replay === true
              ? "stock for this file was already received (replay: nothing added)"
              : `${qty} units received into ${where}`,
          );
        }
      } catch (e) {
        const message = messageOf(e);
        for (const r of resolved) {
          if ((r.plan?.quantity ?? 0) === 0) continue;
          const outcome = done.get(r.row.line);
          if (outcome) outcome.error = message;
        }
      }
    }
    const failed = [...done.values()].filter((o) => o.error).length;
    setOutcomes(done);
    setBusy(false);
    setApplied(failed === 0 && done.size === resolved.length);
    setNotice(
      failed === 0
        ? `Applied: ${addedProducts} products added, ${addedSkus} SKUs added, ${changedPrices} prices set.`
        : `${failed} of ${done.size} rows were refused; the error is on each row. Applying the same file again changes nothing twice.`,
    );
    await load();
  };

  return (
    <>
      <div className="row spread">
        <h1>Upload a sheet</h1>
        <Link href="/office/products">All products</Link>
      </div>
      <p className="muted">
        A CSV (UTF-8) of products and unit counts. The file is read in this browser; the products, SKUs, prices and stock are
        recorded by the office functions, and their answer is what you see here.
      </p>
      <ListState loading={loading} error={loadError} empty={false} emptyText="" />
      {wrongRole && (
        <p className="error" role="alert">
          Only the owner or a manager uploads a sheet.
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}
      {fileError && (
        <p className="error" role="alert">
          {fileError}
        </p>
      )}

      <section className="card" aria-label="The file">
        <h2>The file</h2>
        <p className="muted">Columns: {SHEET_COLUMNS.join(", ")}. Product, group, variant and unit are required.</p>
        <div className="row">
          <button type="button" className="inline" onClick={download}>
            Download the template
          </button>
          <label htmlFor="sheet-file">
            Sheet file (CSV)
            <input
              id="sheet-file"
              type="file"
              accept=".csv,text/csv"
              disabled={loading || busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>
        {fileName && (
          <p className="muted" data-testid="sheet-file-name">
            {fileName}
          </p>
        )}
        {warehouses.length === 0 ? (
          <p className="muted">
            There is no warehouse yet, so unit counts cannot be received. Add one under Stock; products and prices still upload.
          </p>
        ) : (
          <label htmlFor="sheet-warehouse">
            Warehouse for the unit counts
            <select id="sheet-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="card" aria-label="What the file says">
          <h2>What the file says</h2>
          <p className="muted" data-testid="sheet-summary">
            {resolved.length} rows, {withErrors} with errors, {resolved.length - withErrors} ready to apply.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Product</th>
                <th scope="col">Group</th>
                <th scope="col">Variant</th>
                <th scope="col">Size</th>
                <th scope="col">SKU code</th>
                <th scope="col">Price</th>
                <th scope="col">Units</th>
                <th scope="col">Recorded now</th>
                <th scope="col">Problems</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => (
                <tr key={r.row.line} data-testid={`sheet-row-${r.row.line}`}>
                  <td>{r.row.line}</td>
                  <td>{r.row.product}</td>
                  <td>{r.row.group}</td>
                  <td>{r.row.variant}</td>
                  <td>{sizeText(r.row.size, r.row.unit)}</td>
                  <td>{r.plan?.code ?? r.row.code ?? "new code"}</td>
                  <td>{r.row.pricePaisa === null ? "none" : rupees(r.row.pricePaisa)}</td>
                  <td>{r.row.quantity || "-"}</td>
                  <td>
                    {r.plan
                      ? [r.plan.productExists ? "product" : "new product", r.plan.skuExists ? "SKU" : "new SKU"].join(", ")
                      : "-"}
                  </td>
                  <td className={r.errors.length > 0 ? "error" : undefined}>{r.errors.join("; ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {withErrors > 0 && (
            <p className="error" role="alert">
              Fix the rows with problems, or remove them from the file, and upload it again. Nothing is written while a row has a
              problem.
            </p>
          )}
          <div className="row">
            <button type="button" onClick={() => void apply()} disabled={!canApply}>
              {busy ? "Applying…" : applied ? "Applied" : `Apply ${resolved.length - withErrors} rows`}
            </button>
            {stockRows > 0 && warehouses.length === 0 && <span className="muted">No warehouse to receive the units into.</span>}
          </div>
        </section>
      )}

      {outcomes.size > 0 && (
        <section className="card" aria-label="What the database did">
          <h2>What the database did</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Product</th>
                <th scope="col">SKU code</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => {
                const outcome = outcomes.get(r.row.line);
                if (!outcome) return null;
                return (
                  <tr key={r.row.line} data-testid={`sheet-result-${r.row.line}`}>
                    <td>{r.row.line}</td>
                    <td>{r.row.product}</td>
                    <td>{r.plan?.code ?? r.row.code ?? ""}</td>
                    <td className={outcome.error ? "error" : undefined}>{outcome.error ?? outcome.lines.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">
            Stock was received once for this file. Uploading the same file again would receive its units again, so keep this sheet
            as the record of that delivery.
          </p>
        </section>
      )}
    </>
  );
}
