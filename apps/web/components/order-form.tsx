"use client";
import { useEffect, useState } from "react";
import { rupees, toPaisa } from "@/lib/money";
import { signedImageUrls } from "@/lib/product-images";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

/** A line of a request as the office reads it: a SKU and a quantity, and the price the database would take. */
export type RequestLine = {
  line_no: number;
  sku_id: string;
  code: string;
  product_name: string;
  variant: string;
  qty: number;
  price_paisa: number;
};

/**
 * An open request, as app.office_open_cards returns it (migrations 0025 and 20261105150000): a rep's
 * order card (rep_id set) or a salon's request (submitter_kind salon, no rep), at its current version.
 */
export type OrderCard = {
  card_id: string;
  salon_id: string;
  salon_name: string | null;
  submitter_kind: "rep" | "salon";
  rep_id: string | null;
  rep_name: string | null;
  body: string | null;
  created_at: string;
  version: number;
  updated_at: string;
  lines: RequestLine[];
  estimate_paisa: number | null;
};

/** Who sent a request, in words. */
export const requestFrom = (c: OrderCard) =>
  c.submitter_kind === "salon" ? `the salon ${c.salon_name ?? "(unnamed)"}` : (c.rep_name ?? "a rep");

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
// A request's own lines, without prices: the database prices them (the salon's price, else the list price).
const linesOf = (card: OrderCard | null): Line[] =>
  card && card.lines.length > 0
    ? card.lines.map((l) => ({ key: crypto.randomUUID(), skuId: l.sku_id, qty: String(l.qty), price: "" }))
    : [newLine()];
const skuText = (s: Sku, salonPrice: number | undefined) =>
  `${s.code} · ${s.product?.name ?? "Product"} ${s.variant} · ${rupees(Number(s.list_price_paisa))}${
    salonPrice === undefined ? "" : ` · salon price ${rupees(salonPrice)}`
  }`;

/**
 * The reps who may deliver an order for this salon (R4, A-16): its directly assigned rep when it has
 * one (latest salon_rep_assignment row), otherwise the active reps currently assigned (to_date null)
 * to the salon's area's territory. Office users read these tables under RLS; the database checks the
 * same rule again in app.office_create_order. `direct` is true when the salon has its own rep (D-36).
 */
async function territoryReps(salonId: string): Promise<{ reps: Rep[]; direct: boolean }> {
  const [direct] = await rows<{ rep: { id: string; full_name: string; role: string; status: string } | null }>(
    db()
      .from("salon_rep_assignment")
      .select("rep:rep_id(id, full_name, role, status)")
      .eq("salon_id", salonId)
      .order("seq", { ascending: false })
      .limit(1),
  );
  if (direct?.rep) {
    return {
      reps: direct.rep.status === "active" ? [{ id: direct.rep.id, full_name: direct.rep.full_name }] : [],
      direct: true,
    };
  }
  const [salon] = await rows<{ area: { territory_id: string } | null }>(
    db().from("salon").select("area:area_id(territory_id)").eq("id", salonId),
  );
  const territory = salon?.area?.territory_id;
  if (!territory) return { reps: [], direct: false };
  const links = await rows<RepLink>(
    db()
      .from("rep_territory")
      .select("rep:rep_id(id, full_name, role, status)")
      .eq("territory_id", territory)
      .is("to_date", null),
  );
  return {
    reps: links.flatMap((l) =>
      l.rep && l.rep.role === "rep" && l.rep.status === "active" ? [{ id: l.rep.id, full_name: l.rep.full_name }] : [],
    ),
    direct: false,
  };
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
  // The card's rep, pre-selected when it still covers the salon; a salon's request has none.
  const cardRepId = card?.rep_id ?? null;
  const cardRepName = card?.rep_name ?? "The card's rep";
  const [repNote, setRepNote] = useState<string | null>(null);
  // The salon's own prices by SKU (read from the database; it also applies them, app.build_order).
  const [salonPrices, setSalonPrices] = useState<Record<string, number>>({});
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState("CASH");
  const [lines, setLines] = useState<Line[]>(() => linesOf(card));
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

  // The salon's territory reps; the card's rep stays selected only when it is one of them. FLOW-11 (P1-30):
  // a salon with its own rep (D-36) gets that rep by default, so the order carries the salon's rep and rate;
  // "No rep (office delivers)" stays a choice (A-16).
  useEffect(() => {
    setReps([]);
    setRepNote(null);
    if (!salonId) return;
    const read = async () => {
      setRepsLoading(true);
      try {
        const { reps: r, direct } = await territoryReps(salonId);
        setReps(r);
        const own = direct ? (r[0]?.id ?? "") : "";
        setRepId((current) => (r.some((x) => x.id === current) ? current : own));
        if (own && !cardRepId) {
          setRepNote(
            `${r[0]?.full_name ?? "The salon's rep"} is this salon's own rep, so they are chosen; their commission rate for this salon applies. Choose "No rep" if the office delivers.`,
          );
        }
        if (cardRepId && !r.some((x) => x.id === cardRepId)) {
          setRepNote(`${cardRepName} no longer covers this salon's territory, so no rep is selected.`);
        }
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        setRepsLoading(false);
      }
    };
    void read();
  }, [salonId, cardRepId, cardRepName]);

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
            // The version the office looked at: the database refuses the order if the request changed since.
            p_card_version: card?.version ?? null,
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
      <h2>
        {card
          ? card.submitter_kind === "salon"
            ? "Create order from a salon request"
            : "Create order from a card"
          : "Create New Order"}
      </h2>
      {card && (
        <>
          <p className="muted">
            {card.submitter_kind === "salon" ? "Request from the salon" : `Card from ${card.rep_name ?? "a rep"}`} for{" "}
            <strong>{salonName}</strong> (version {card.version}):
          </p>
          {card.body && <blockquote data-testid="card-body">{card.body}</blockquote>}
          {card.lines.length > 0 && <p className="muted">Its lines are filled in below; you may change them.</p>}
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
