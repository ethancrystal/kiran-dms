"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { ListCapNote } from "@/components/list-cap-note";
import { LinePicker, newPick, type PickLine, type PickOption, picksPayload, repProductOptions } from "@/components/request-lines";
import { rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

// app.my_cards reads the newest 50 (migration 20261105150000).
const CAP = 50;

type CardLine = { line_no: number; sku_id: string; code: string; product_name: string; variant: string; qty: number };
type Card = {
  card_id: string;
  salon_id: string;
  salon_name: string | null;
  body: string;
  created_at: string;
  status: "open" | "converted" | "dismissed" | "cancelled";
  order_id: string | null;
  reason: string | null;
  version: number;
  lines: CardLine[];
};

// Characters of the order id shown to the rep: enough to quote it to the office.
const SHORT_ID = 8;
// app.rep_edit_card: a note of 1 to 2000 characters.
const CARD_MAX = 2000;
const CARD_ROWS = 3;
const STATUS_TEXT: Record<Card["status"], string> = {
  open: "Open",
  converted: "Converted",
  dismissed: "Dismissed",
  cancelled: "Cancelled",
};

// The rep's order cards (ORD-14, D-30, D-34): app.my_cards, the newest 50, each at its current version
// with its products, and open, converted into an order by the office, dismissed with the office's
// reason, or cancelled. While a card is open the rep may edit it (a new version, app.rep_edit_card) or
// cancel it (app.rep_cancel_card); once the office has acted the database refuses both. A salon the
// rep no longer covers shows no name.
export default function MyCards() {
  const [list, setList] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [options, setOptions] = useState<PickOption[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList((await rpc<Card[]>("my_cards")) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const read = async () => {
      try {
        setOptions(await repProductOptions());
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void read();
  }, []);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My cards</h1>
      <p className="muted">What salons asked for. Save New Order Details on a salon&apos;s page; the office makes the order.</p>
      {notice && <output className="ok">{notice}</output>}
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && list.length === 0 && <p className="muted">No order cards yet.</p>}
      <ListCapNote shown={list.length} cap={CAP} what="order cards" />
      {list.length > 0 && (
        <ul className="plain">
          {list.map((c) => (
            <li key={c.card_id}>
              <span className="badge">{STATUS_TEXT[c.status]}</span>{" "}
              {c.salon_name ? (
                <a href={`/app/salons/${c.salon_id}`}>{c.salon_name}</a>
              ) : (
                <span className="muted">A salon you no longer cover</span>
              )}
              <br />
              {c.body}
              {c.lines.length > 0 && (
                <ul>
                  {c.lines.map((l) => (
                    <li key={l.line_no}>
                      {l.qty} × {l.code} · {l.product_name} {l.variant}
                    </li>
                  ))}
                </ul>
              )}
              <br />
              <span className="muted">
                {when(c.created_at)}
                {c.version > 1 && ` · edited (version ${c.version})`}
                {c.status === "converted" && c.order_id && ` · made into order ${c.order_id.slice(0, SHORT_ID)}`}
                {(c.status === "dismissed" || c.status === "cancelled") && c.reason && ` · ${c.reason}`}
              </span>
              {c.status === "open" && editing !== c.card_id && (
                <div className="row">
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      setNotice(null);
                      setEditing(c.card_id);
                    }}
                  >
                    Edit card
                  </button>
                  <ConfirmAction
                    label="Cancel card"
                    confirmLabel="Cancel this card"
                    reasonLabel="Why cancel (optional)"
                    reasonRequired={false}
                    danger
                    onConfirm={async (reason) => {
                      await rpc("rep_cancel_card", { p_card_id: c.card_id, p_reason: reason || null });
                      setNotice("Card cancelled.");
                      await load();
                    }}
                  />
                </div>
              )}
              {c.status === "open" && editing === c.card_id && (
                <EditCard
                  card={c}
                  options={options}
                  onCancel={() => setEditing(null)}
                  onDone={async (version) => {
                    setEditing(null);
                    setNotice(`Card saved as version ${version}.`);
                    await load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// An edit replaces the card's note and products with a new version; the earlier one is kept. The
// database refuses it once the office has acted, and shows why. One key per attempt (H-08).
function EditCard({
  card,
  options,
  onDone,
  onCancel,
}: {
  card: Card;
  options: PickOption[];
  onDone: (version: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(card.body);
  const [picks, setPicks] = useState<PickLine[]>(() =>
    card.lines.length > 0 ? card.lines.map((l) => newPick(l.sku_id, String(l.qty))) : [newPick()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="card"
      aria-label="Edit order card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await rpc<{ version: number }>("rep_edit_card", {
            p_client_id: clientId,
            p_card_id: card.card_id,
            p_body: body.trim(),
            p_lines: picksPayload(picks),
          });
          setClientId(crypto.randomUUID());
          await onDone(r.version);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`edit-body-${card.card_id}`}>What the salon needs now</label>
      <textarea
        id={`edit-body-${card.card_id}`}
        rows={CARD_ROWS}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        maxLength={CARD_MAX}
      />
      <LinePicker name="Edit" options={options} lines={picks} onChange={setPicks} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : "Save card"}
        </button>
        <button type="button" className="inline link" onClick={onCancel} disabled={busy}>
          Keep as it was
        </button>
      </div>
    </form>
  );
}
