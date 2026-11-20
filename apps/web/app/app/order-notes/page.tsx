"use client";
import { useCallback, useEffect, useState } from "react";
import { LinePicker, newPick, type PickLine, type PickOption, picksPayload, repProductOptions } from "@/components/request-lines";
import { rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

// A rep's Order Notes (MJ, 2026-11-20 decision): a dedicated area to write down what a
// salon client wants, including a POTENTIAL salon that the office has not approved yet.
// Every note is an app.rep_create_card call (an append-only order_intake_card); the office
// makes the order from it once the salon is approved. The list and all figures come from
// the database (app.my_cards), and a refusal is shown as the database words it.

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
type SalonOption = {
  id: string;
  name: string | null;
  approval_status: "pending" | "approved" | "rejected";
  area_name: string | null;
};

const NOTE_MAX = 2000;
const STATUS: Record<Card["status"], string> = {
  open: "Open",
  converted: "Made into an order",
  dismissed: "Dismissed",
  cancelled: "Cancelled",
};
const approvalWord = (s: SalonOption["approval_status"]) =>
  s === "approved" ? "approved" : s === "pending" ? "waiting for office approval" : "rejected";

export default function OrderNotes() {
  const [list, setList] = useState<Card[]>([]);
  const [salons, setSalons] = useState<SalonOption[]>([]);
  const [options, setOptions] = useState<PickOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cards, mine, picks] = await Promise.all([
        rpc<Card[]>("my_cards"),
        rpc<SalonOption[]>("my_salons", {}),
        repProductOptions(),
      ]);
      setList(cards ?? []);
      // A rejected salon is shown because the rep may still be visiting it, but the form
      // lets the database give the refusal rather than offering a note that cannot save.
      setSalons(
        (mine ?? [])
          .filter((s) => s.approval_status !== "rejected")
          .map((s) => ({ id: s.id, name: s.name, approval_status: s.approval_status, area_name: s.area_name })),
      );
      setOptions(picks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>Order Notes</h1>
      <p className="muted">
        Write down what a salon client wants, even one the office has not approved yet. The office makes the order from your note.
        Check in first, then add a note.
      </p>
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <AddNote
        salons={salons}
        options={options}
        onDone={async (m) => {
          setNotice(m);
          await load();
        }}
      />

      <h2>Saved notes</h2>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {!loading && list.length === 0 && <p className="muted">No order notes yet.</p>}
      {list.length > 0 && (
        <ul className="plain">
          {list.map((c) => (
            <li key={c.card_id} data-testid="order-note">
              <span className="badge">{STATUS[c.status]}</span>{" "}
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
                {c.status === "converted" && c.order_id && ` · order ${c.order_id.slice(0, 8)}`}
                {(c.status === "dismissed" || c.status === "cancelled") && c.reason && ` · ${c.reason}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function AddNote({
  salons,
  options,
  onDone,
}: {
  salons: SalonOption[];
  options: PickOption[];
  onDone: (message: string) => Promise<void>;
}) {
  const [salonId, setSalonId] = useState("");
  const [body, setBody] = useState("");
  const [picks, setPicks] = useState<PickLine[]>(() => [newPick()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const chosen = salons.find((s) => s.id === salonId);

  return (
    <form
      className="card"
      aria-label="Add an order note"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (!salonId) throw new Error("Choose the salon this note is for.");
          const lines = picksPayload(picks);
          await rpc("rep_create_card", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_body: body.trim(),
            p_visit_id: null,
            p_lines: lines,
          });
          setBody("");
          setPicks([newPick()]);
          setClientId(crypto.randomUUID());
          await onDone(`Order note saved for ${chosen?.name ?? "the salon"}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>New order note</h2>
      <label htmlFor="note-salon">Salon client</label>
      <select id="note-salon" value={salonId} onChange={(e) => setSalonId(e.target.value)} required>
        <option value="">Choose a salon…</option>
        {salons.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name ?? "Unnamed salon"}
            {s.area_name ? ` · ${s.area_name}` : ""} · {approvalWord(s.approval_status)}
          </option>
        ))}
      </select>
      {salons.length === 0 && <p className="muted">No salons are assigned to your territory yet. Ask your manager.</p>}
      <label htmlFor="note-body">What the client wants</label>
      <textarea id="note-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={NOTE_MAX} />
      <p className="muted">Products (optional): pick them so the office can make the order in one click.</p>
      <LinePicker name="Note" options={options} lines={picks} onChange={setPicks} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save order note"}
      </button>
    </form>
  );
}
