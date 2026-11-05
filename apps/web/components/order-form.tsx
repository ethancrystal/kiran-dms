"use client";
import { useEffect, useState } from "react";
import { rupees, toPaisa } from "@/lib/money";
import { signedImageUrls } from "@/lib/product-images";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

/** An open order card, as app.office_open_cards returns it (migration 0025). */
export type OrderCard = {
  card_id: string;
  salon_id: string;
  salon_name: string | null;
  rep_id: string;
  rep_name: string;
  body: string;
  created_at: string;
};

/** The order row app.office_create_order returns (public.sales_order, the fields this page shows). */
export type CreatedOrder = {
  id: string;
  status: string;
  total_paisa: number;
  hold_credit: string | null;
  hold_discount: string | null;
};

type SalonOption = { id: string; name: string | null; area: { name: string } | null };
type Sku = {
  id: string;
  code: string;
  variant: string;
  list_price_paisa: number;
  product: { name: string; image_path: string | null } | null;
};
/** A salon's own price for a SKU, from app.office_salon_prices (D-37); only SKUs that have one. */
type SalonPrice = { sku_id: string; salon_price_paisa: number | null };
type Rep = { id: string; full_name: string };
type RepLink = { rep: { id: string; full_name: string; role: string; status: string } | null };
type Line = { key: string; skuId: string; qty: string; price: string };

// The plans of public.plan_code (migration 0012); the database checks the salon may use the plan.
const PLANS: Array<[string, string]> = [
  ["CASH", "Cash"],
  ["INST2", "2 installments"],
  ["INST4", "4 installments"],
];
const MAX_LINES = 50; // app.build_order: an order has 1 to 50 lines.
const SALON_LIMIT = 500;
// Rupees as typed: up to 9 digits and 2 decimals (lib/money.ts toPaisa).
const PRICE_MAX_CHARS = 12;
const SKU_LIMIT = 1000;
const QTY_MAX = 10_000;

const newLine = (): Line => ({ key: crypto.randomUUID(), skuId: "", qty: "1", price: "" });
const skuText = (s: Sku, salonPrice: number | undefined) =>
  `${s.code} · ${s.product?.name ?? "Product"} ${s.variant} · ${rupees(Number(s.list_price_paisa))}${
    salonPrice === undefined ? "" : ` · salon price ${rupees(salonPrice)}`
  }`;

/**
 * The reps who may deliver an order for this salon (R4, A-16): its directly assigned rep when it has
 * one (latest salon_rep_assignment row), otherwise the active reps currently assigned (to_date null)
 * to the salon's area's territory. Office users read these tables under RLS; the database checks the
 * same rule again in app.office_create_order.
 */
async function territoryReps(salonId: string): Promise<Rep[]> {
  const [direct] = await rows<{ rep: { id: string; full_name: string; role: string; status: string } | null }>(
    db()
      .from("salon_rep_assignment")
      .select("rep:rep_id(id, full_name, role, status)")
      .eq("salon_id", salonId)
      .order("seq", { ascending: false })
      .limit(1),
  );
  if (direct?.rep) {
    return direct.rep.status === "active" ? [{ id: direct.rep.id, full_name: direct.rep.full_name }] : [];
  }
  const [salon] = await rows<{ area: { territory_id: string } | null }>(
    db().from("salon").select("area:area_id(territory_id)").eq("id", salonId),
  );
  const territory = salon?.area?.territory_id;
  if (!territory) return [];
  const links = await rows<RepLink>(
    db()
      .from("rep_territory")
      .select("rep:rep_id(id, full_name, role, status)")
      .eq("territory_id", territory)
      .is("to_date", null),
  );
  return links.flatMap((l) =>
    l.rep && l.rep.role === "rep" && l.rep.status === "active" ? [{ id: l.rep.id, full_name: l.rep.full_name }] : [],
  );
}

/** The lines as app.office_create_order takes them, or an error to show before anything is sent. */
function linesPayload(lines: Line[]): Array<Record<string, unknown>> {
  if (lines.some((l) => !l.skuId)) throw new Error("Choose a product on every line, or remove the empty line.");
  if (lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) < 1)) {
    throw new Error("Enter a whole quantity of at least 1 on every line.");
  }
  if (lines.some((l) => l.price.trim() !== "" && toPaisa(l.price) === null)) {
    throw new Error("Enter the price per unit in rupees, for example 1500 or 1500.50, or leave it empty.");
  }
  return lines.map((l) => ({
    sku_id: l.skuId,
    qty: Number(l.qty),
    ...(l.price.trim() === "" ? {} : { unit_price_paisa: toPaisa(l.price) }),
  }));
}

// Create New Order (D-30; spec section 6): the owner or a manager makes an order, directly or from a
// rep's order card. Salon, lines and plan; the delivering rep is one of the reps covering the salon's
// territory, or none (the office delivers). From a card the salon is the card's and the card's rep is
// pre-selected when it still covers that territory. Prices, credit, discount approval and who may be
// assigned are all decided by app.office_create_order; this form shows its answer or its words.
export function OrderForm({
  card,
  onDone,
  onCancel,
}: {
  card: OrderCard | null;
  onDone: (order: CreatedOrder, salonName: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [salons, setSalons] = useState<SalonOption[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [salonId, setSalonId] = useState(card?.salon_id ?? "");
  const [reps, setReps] = useState<Rep[]>([]);
  const [repsLoading, setRepsLoading] = useState(false);
  const [repId, setRepId] = useState(card?.rep_id ?? "");
  const [repNote, setRepNote] = useState<string | null>(null);
  // The salon's own prices by SKU (read from the database; it also applies them, app.build_order).
  const [salonPrices, setSalonPrices] = useState<Record<string, number>>({});
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState("CASH");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed read of the catalogue, salons or reps: kept apart from the submit error, so a submit
  // does not hide it.
  const [loadError, setLoadError] = useState<string | null>(null);
  // One key per attempt: a retry after a lost answer is the same order (H-08, ORD-10).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  // The catalogue (active, priced SKUs) and, for a direct order, the salons to choose from.
  useEffect(() => {
    const read = async () => {
      try {
        const [s, k] = await Promise.all([
          card
            ? Promise.resolve([] as SalonOption[])
            : rows<SalonOption>(
                db()
                  .from("salon")
                  .select("id, name, area:area_id(name)")
                  .eq("approval_status", "approved")
                  .order("name", { nullsFirst: false })
                  .order("id")
                  .limit(SALON_LIMIT),
              ),
          rows<Sku>(
            db()
              .from("sku")
              .select("id, code, variant, list_price_paisa, product:product_id(name, image_path)")
              .eq("active", true)
              .not("list_price_paisa", "is", null)
              .order("code")
              .limit(SKU_LIMIT),
          ),
        ]);
        setSalons(s);
        setSkus(k);
        // Pictures are a help, not a requirement: a storage failure shows "no picture", not an error.
        setPictures(await signedImageUrls(k.map((x) => x.product?.image_path)));
      } catch (e) {
        setLoadError((e as Error).message);
      }
    };
    void read();
  }, [card]);

  // The salon's own prices (D-37). Shown on the lines; the database applies them to a line sent with no price.
  useEffect(() => {
    setSalonPrices({});
    if (!salonId) return;
    const read = async () => {
      try {
        const sheet = (await rpc<SalonPrice[]>("office_salon_prices", { p_salon_id: salonId })) ?? [];
        setSalonPrices(
          Object.fromEntries(
            sheet.flatMap((r) => (r.salon_price_paisa === null ? [] : [[r.sku_id, Number(r.salon_price_paisa)]])),
          ),
        );
      } catch (e) {
        setLoadError((e as Error).message);
      }
    };
    void read();
  }, [salonId]);

  // The salon's territory reps; the card's rep stays selected only when it is one of them.
  useEffect(() => {
    setReps([]);
    setRepNote(null);
    if (!salonId) return;
    const read = async () => {
      setRepsLoading(true);
      try {
        const r = await territoryReps(salonId);
        setReps(r);
        setRepId((current) => (r.some((x) => x.id === current) ? current : ""));
        if (card && !r.some((x) => x.id === card.rep_id)) {
          setRepNote(`${card.rep_name} no longer covers this salon's territory, so no rep is selected.`);
        }
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        setRepsLoading(false);
      }
    };
    void read();
  }, [salonId, card]);

  const setLine = (key: string, change: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const salonName = card ? (card.salon_name ?? "Unnamed salon") : (salons.find((s) => s.id === salonId)?.name ?? "Unnamed salon");

  return (
    <form
      className="card"
      aria-label="New order"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (!salonId) throw new Error("Choose the salon.");
          const order = await rpc<CreatedOrder>("office_create_order", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_plan: plan,
            p_lines: linesPayload(lines),
            p_assigned_rep_id: repId || null,
            p_intake_card_id: card?.card_id ?? null,
          });
          setLines([newLine()]);
          setRepId("");
          setPlan("CASH");
          if (!card) setSalonId("");
          setClientId(crypto.randomUUID());
          await onDone(order, salonName);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{card ? "Create order from a card" : "Create New Order"}</h2>
      {card && (
        <>
          <p className="muted">
            Card from {card.rep_name} for <strong>{salonName}</strong>:
          </p>
          <blockquote data-testid="card-body">{card.body}</blockquote>
        </>
      )}
      {!card && (
        <>
          <label htmlFor="order-salon">Salon</label>
          <select id="order-salon" value={salonId} onChange={(e) => setSalonId(e.target.value)}>
            <option value="">Choose a salon</option>
            {salons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? "Unnamed salon"}
                {s.area ? ` · ${s.area.name}` : ""}
              </option>
            ))}
          </select>
          {salons.length === SALON_LIMIT && (
            <p className="muted">
              Showing the first {SALON_LIMIT} salons by name. A salon further down the list cannot be picked here yet; an order
              for it can be made from a rep&apos;s order card.
            </p>
          )}
        </>
      )}

      <h3>Lines</h3>
      {skus.length === 0 && (
        <p className="muted">No active, priced products yet. The owner or a manager sets prices on Products.</p>
      )}
      {lines.map((l, n) => (
        <fieldset key={l.key} className="inline-form">
          <legend>Line {n + 1}</legend>
          <label htmlFor={`sku-${l.key}`}>Product {n + 1}</label>
          <select id={`sku-${l.key}`} value={l.skuId} onChange={(e) => setLine(l.key, { skuId: e.target.value })}>
            <option value="">Choose a product</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {skuText(s, salonPrices[s.id])}
              </option>
            ))}
          </select>
          <LinePicture sku={skus.find((s) => s.id === l.skuId)} pictures={pictures} />
          {l.skuId && salonPrices[l.skuId] !== undefined && (
            <p className="muted" data-testid={`salon-price-${n + 1}`}>
              This salon&apos;s price: {rupees(salonPrices[l.skuId])}
            </p>
          )}
          <label htmlFor={`qty-${l.key}`}>Quantity {n + 1}</label>
          <input
            id={`qty-${l.key}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={QTY_MAX}
            step={1}
            value={l.qty}
            onChange={(e) => setLine(l.key, { qty: e.target.value })}
          />
          <label htmlFor={`price-${l.key}`}>Price per unit (Rs, optional) {n + 1}</label>
          <input
            id={`price-${l.key}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={l.skuId && salonPrices[l.skuId] !== undefined ? "Salon price" : "List price"}
            value={l.price}
            onChange={(e) => setLine(l.key, { price: e.target.value })}
            maxLength={PRICE_MAX_CHARS}
          />
          {lines.length > 1 && (
            <button type="button" className="inline link" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
              Remove line {n + 1}
            </button>
          )}
        </fieldset>
      ))}
      {lines.length < MAX_LINES && (
        <button type="button" className="inline" onClick={() => setLines((all) => [...all, newLine()])}>
          Add a line
        </button>
      )}
      <p className="muted">
        Leave the price empty to sell at the salon&apos;s price, or the list price when it has none. A price below the list price
        is a discount the database may send for approval.
      </p>

      <label htmlFor="order-plan">Plan</label>
      <select id="order-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
        {PLANS.map(([code, text]) => (
          <option key={code} value={code}>
            {text}
          </option>
        ))}
      </select>

      <label htmlFor="order-rep">Delivering rep</label>
      <select id="order-rep" value={repId} onChange={(e) => setRepId(e.target.value)} disabled={!salonId}>
        <option value="">No rep (office delivers)</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.full_name}
          </option>
        ))}
      </select>
      {repsLoading && (
        <p className="muted" aria-busy="true">
          Loading the salon&apos;s reps…
        </p>
      )}
      {salonId && !repsLoading && reps.length === 0 && (
        <p className="muted">No rep covers this salon&apos;s territory; the office delivers.</p>
      )}
      {repNote && <p className="muted">{repNote}</p>}

      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : "Create order"}
        </button>
        <button type="button" className="inline link" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A small picture of the line's product, when it has one and storage gave a link. */
function LinePicture({ sku, pictures }: { sku: Sku | undefined; pictures: Record<string, string> }) {
  const path = sku?.product?.image_path;
  const url = path ? pictures[path] : undefined;
  if (!url) return null;
  return <img className="thumb small" src={url} alt={sku?.product?.name ?? "Product"} />;
}

/** The order the database made, in words: its status, total and any hold that keeps it in draft. */
export function orderSummary(order: CreatedOrder): string {
  const holds = [order.hold_credit, order.hold_discount].filter((h): h is string => Boolean(h)).map(label);
  return `${label(order.status)} · ${rupees(Number(order.total_paisa))}${holds.length ? ` (held: ${holds.join(", ")})` : ""}`;
}
