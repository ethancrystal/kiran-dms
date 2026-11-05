"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import type { Approval } from "@/lib/approvals";
import { rupees, toPaisa } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Location = {
  id: string;
  kind: string;
  name: string;
  owner_user_id: string | null;
  bag_value_limit_paisa: number | null;
  active: boolean;
};
type Person = { id: string; full_name: string; role: string; status: string };
type Sku = { id: string; code: string; variant: string | null };
type OnHand = { location_id: string; sku_id: string; on_hand: number };
type Issue = {
  id: string;
  direction: string;
  warehouse_id: string;
  bag_id: string;
  lines: Array<{ sku_id: string; qty: number }>;
  counted_lines: Array<{ sku_id: string; qty: number }> | null;
  status: string;
  decision_note: string | null;
  created_at: string;
};
type IssueLine = { sku: string; qty: string };

// The database's own minimums: app.office_cancel_stock_issue and app.request_approval reasons are at
// least 3 characters (app.assert_reason and the approval form's shared minimum).
const REASON_MIN = 3;
const ISSUE_LIST = 50;
const MAX_ISSUE_LINES = 10;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

/** One client id per form, kept until the database accepts the write, so a retry replays it (H-08). */
function useKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return { key, renew: () => setKey(crypto.randomUUID()) };
}

// Stock (owner or manager at AAL2; INV-02, INV-03, CTL-05, A-08). Locations, stock on hand
// (app.stock_on_hand), opening stock in a warehouse through an approved adjustment (app.request_approval,
// decided by another office user on Approvals, posted with app.office_post_adjustment), and stock issues
// to a rep's bag (app.office_propose_stock_issue; nothing moves until the rep confirms the same count on
// its phone, app.rep_confirm_stock_issue; app.office_cancel_stock_issue cancels a pending or disputed
// one). A rep bag and its value limit are the owner's (A-08): the form shows only for the owner and the
// database refuses anyone else. Stock is never calculated here: every figure is the database's.
export default function Stock() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [onHand, setOnHand] = useState<OnHand[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [adjustments, setAdjustments] = useState<Approval[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, p, s, h, i, a, user] = await Promise.all([
        rows<Location>(
          db()
            .from("stock_location")
            .select("id, kind, name, owner_user_id, bag_value_limit_paisa, active")
            .order("kind")
            .order("name"),
        ),
        rows<Person>(db().from("user_profile").select("id, full_name, role, status").order("full_name")),
        rows<Sku>(
          db().from("sku").select("id, code, variant").eq("active", true).not("list_price_paisa", "is", null).order("code"),
        ),
        rpc<OnHand[]>("stock_on_hand", { p_location_id: null }),
        rows<Issue>(
          db()
            .from("stock_issue")
            .select("id, direction, warehouse_id, bag_id, lines, counted_lines, status, decision_note, created_at")
            .order("created_at", { ascending: false })
            .limit(ISSUE_LIST),
        ),
        rpc<Approval[]>("office_pending_approvals"),
        supabaseBrowser().auth.getUser(),
      ]);
      setLocations(l);
      setPeople(p);
      setSkus(s);
      setOnHand(h ?? []);
      setIssues(i);
      setAdjustments((a ?? []).filter((x) => x.kind === "adjustment"));
      const me = user.data.user?.id;
      setMyRole(p.find((x) => x.id === me)?.role ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    await load();
  };
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const personName = (id: string | null) => (id ? (people.find((p) => p.id === id)?.full_name ?? "Unknown") : "");
  const skuName = (id: string) => {
    const s = skus.find((x) => x.id === id);
    return s ? `${s.code}${s.variant ? ` ${s.variant}` : ""}` : "Unknown SKU";
  };
  const warehouses = locations.filter((l) => l.kind === "warehouse" && l.active);
  const bags = locations.filter((l) => l.kind === "rep_bag" && l.active);
  const repsWithoutBag = people.filter(
    (p) => p.role === "rep" && p.status === "active" && !locations.some((l) => l.kind === "rep_bag" && l.owner_user_id === p.id),
  );
  const linesText = (ls: Array<{ sku_id: string; qty: number }> | null) =>
    (ls ?? []).map((x) => `${x.qty} × ${skuName(x.sku_id)}`).join(", ");

  return (
    <>
      <h1>Stock</h1>
      <p className="muted">
        Stock moves only through the database: opening stock by an approved adjustment, and stock to a rep&apos;s bag only when
        the rep confirms the same count.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={false} emptyText="" />

      {!loading && (
        <>
          <section aria-labelledby="locations-h">
            <h2 id="locations-h">Locations ({locations.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Rep</th>
                  <th>Bag value limit</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} data-testid="stock-location">
                    <td data-label="Kind">{label(l.kind)}</td>
                    <td data-label="Name">{l.name}</td>
                    <td data-label="Rep">{personName(l.owner_user_id)}</td>
                    <td data-label="Bag value limit">
                      {l.bag_value_limit_paisa === null ? "" : rupees(Number(l.bag_value_limit_paisa))}
                    </td>
                    <td data-label="Active">{l.active ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AddWarehouse onDone={done} />
            {myRole === "owner" && <AddBag reps={repsWithoutBag} onDone={done} />}
          </section>

          <section aria-labelledby="onhand-h">
            <h2 id="onhand-h">Stock on hand</h2>
            {onHand.length === 0 ? (
              <p className="muted">No stock anywhere yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>SKU</th>
                    <th>On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {onHand.map((h) => (
                    <tr key={`${h.location_id}:${h.sku_id}`} data-testid="on-hand">
                      <td data-label="Location">{locName(h.location_id)}</td>
                      <td data-label="SKU">{skuName(h.sku_id)}</td>
                      <td data-label="On hand">{h.on_hand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="opening-h">
            <h2 id="opening-h">Opening stock in a warehouse</h2>
            <p className="muted">
              Ask for an adjustment; another office user approves it on Approvals (the owner above the threshold), then post it
              here.
            </p>
            <OpeningStock warehouses={warehouses} skus={skus} onDone={done} />
            {adjustments.length > 0 && (
              <ul className="plain">
                {adjustments.map((a) => (
                  <li key={a.request_id} data-testid="adjustment">
                    {a.location_name} · {a.sku_code} · {Number(a.qty_delta) > 0 ? `+${a.qty_delta}` : a.qty_delta} units ·{" "}
                    {a.status === "approved" ? "approved" : "waiting for approval"} · asked by {a.maker_name}
                    {a.status === "approved" && <PostAdjustment approval={a} onDone={done} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="issue-h">
            <h2 id="issue-h">Issue stock to a rep&apos;s bag</h2>
            <IssueForm warehouses={warehouses} bags={bags} skus={skus} personName={personName} onDone={done} />
          </section>

          <section aria-labelledby="issues-h">
            <h2 id="issues-h">Stock issues (newest {ISSUE_LIST})</h2>
            {issues.length === 0 ? (
              <p className="muted">No stock issue yet.</p>
            ) : (
              <ul className="plain">
                {issues.map((i) => (
                  <li key={i.id} data-testid="stock-issue">
                    <span className="badge">{label(i.status)}</span> {locName(i.warehouse_id)}{" "}
                    {i.direction === "to_rep" ? "to" : "from"} {locName(i.bag_id)}: {linesText(i.lines)}
                    {i.status === "disputed" && <> · the rep counted {linesText(i.counted_lines) || "nothing"}</>}
                    <br />
                    <span className="muted">
                      {when(i.created_at)}
                      {i.decision_note && ` · ${i.decision_note}`}
                    </span>
                    {(i.status === "pending" || i.status === "disputed") && (
                      <div className="row">
                        <ConfirmAction
                          label="Cancel issue"
                          confirmLabel="Cancel this stock issue"
                          reasonLabel="Why the issue is cancelled"
                          reasonMinLength={REASON_MIN}
                          danger
                          onConfirm={async (reason) => {
                            await rpc("office_cancel_stock_issue", { p_issue_id: i.id, p_reason: reason });
                            await done("Stock issue cancelled; nothing moved.");
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

type Done = (message: string) => Promise<void>;

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

function AddWarehouse({ onDone }: { onDone: Done }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useKey();
  return (
    <form
      aria-label="Add a warehouse"
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await rpc("office_create_location", { p_id: key, p_kind: "warehouse", p_name: name });
          renew();
          setName("");
          await onDone(`Warehouse ${name} added.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        New warehouse name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <button type="submit" className="inline" disabled={busy}>
        Add warehouse
      </button>
      <FormError error={error} />
    </form>
  );
}

function AddBag({ reps, onDone }: { reps: Person[]; onDone: Done }) {
  const [rep, setRep] = useState("");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useKey();
  return (
    <form
      aria-label="Add a rep bag"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const paisa = toPaisa(limit);
        if (paisa === null) {
          setError("Enter the bag value limit in rupees, for example 50000.");
          return;
        }
        setBusy(true);
        try {
          await rpc("office_create_location", {
            p_id: key,
            p_kind: "rep_bag",
            p_name: name,
            p_owner_user_id: rep || null,
            p_bag_value_limit_paisa: paisa,
          });
          renew();
          setName("");
          setLimit("");
          setRep("");
          await onDone(`Bag ${name} added with a value limit of ${rupees(paisa)}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Add a rep bag (owner only, A-08)</h3>
      <label htmlFor="bag-rep">Rep for the bag</label>
      <select id="bag-rep" value={rep} onChange={(e) => setRep(e.target.value)} required>
        <option value="">Choose a rep without a bag</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.full_name}
          </option>
        ))}
      </select>
      <label htmlFor="bag-name">Bag name</label>
      <input id="bag-name" value={name} onChange={(e) => setName(e.target.value)} required />
      <label htmlFor="bag-limit">Bag value limit (Rs, at list price)</label>
      <input id="bag-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} required />
      <FormError error={error} />
      <button type="submit" className="inline" disabled={busy}>
        Add bag
      </button>
    </form>
  );
}

function OpeningStock({
  warehouses,
  skus,
  onDone,
}: {
  warehouses: Array<{ id: string; name: string }>;
  skus: Sku[];
  onDone: Done;
}) {
  const [warehouse, setWarehouse] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useKey();
  return (
    <form
      aria-label="Ask for opening stock"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const units = Number.parseInt(qty, 10);
        if (!Number.isInteger(units) || units <= 0 || String(units) !== qty.trim()) {
          setError("Enter a whole number of units above 0.");
          return;
        }
        setBusy(true);
        try {
          await rpc("request_approval", {
            p_client_id: key,
            p_kind: "adjustment",
            p_subject_type: "stock_location",
            p_subject_id: warehouse || null,
            p_payload: { sku_id: sku, qty_delta: units },
            p_reason: reason,
          });
          renew();
          setQty("");
          setReason("");
          await onDone("Opening stock requested; another office user must approve it on Approvals.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="opening-warehouse">Warehouse for the opening stock</label>
      <select id="opening-warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>
        <option value="">Choose a warehouse</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <label htmlFor="opening-sku">SKU for the opening stock</label>
      <select id="opening-sku" value={sku} onChange={(e) => setSku(e.target.value)} required>
        <option value="">Choose a SKU</option>
        {skus.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code}
            {s.variant ? ` ${s.variant}` : ""}
          </option>
        ))}
      </select>
      <label htmlFor="opening-qty">Units counted in</label>
      <input id="opening-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />
      <label htmlFor="opening-reason">Why (for the approver)</label>
      <input
        id="opening-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={REASON_MIN}
        maxLength={300}
      />
      <FormError error={error} />
      <button type="submit" className="inline" disabled={busy}>
        Ask for approval
      </button>
    </form>
  );
}

function PostAdjustment({ approval, onDone }: { approval: Approval; onDone: Done }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useKey();
  return (
    <>
      {" "}
      <button
        type="button"
        className="inline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await rpc("office_post_adjustment", { p_client_id: key, p_approval_id: approval.request_id });
            renew();
            await onDone(`Posted: ${approval.qty_delta} units of ${approval.sku_code} at ${approval.location_name}.`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Post to stock
      </button>
      <FormError error={error} />
    </>
  );
}

function IssueForm({
  warehouses,
  bags,
  skus,
  personName,
  onDone,
}: {
  warehouses: Array<{ id: string; name: string }>;
  bags: Location[];
  skus: Sku[];
  personName: (id: string | null) => string;
  onDone: Done;
}) {
  const [warehouse, setWarehouse] = useState("");
  const [bag, setBag] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([{ sku: "", qty: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useKey();
  const setLine = (n: number, patch: Partial<IssueLine>) =>
    setLines((all) => all.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  return (
    <form
      aria-label="Issue stock to a bag"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const parsed = lines.map((l) => ({ sku_id: l.sku, qty: Number(l.qty) }));
        if (parsed.some((l) => !l.sku_id || !Number.isInteger(l.qty) || l.qty <= 0)) {
          setError("Each line needs a SKU and a whole quantity above 0.");
          return;
        }
        setBusy(true);
        try {
          await rpc("office_propose_stock_issue", {
            p_client_id: key,
            p_direction: "to_rep",
            p_warehouse_id: warehouse || null,
            p_bag_id: bag || null,
            p_lines: parsed,
            p_note: note || null,
          });
          renew();
          setLines([{ sku: "", qty: "" }]);
          setNote("");
          await onDone("Stock issue proposed. Nothing moves until the rep confirms the same count.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="issue-warehouse">From warehouse</label>
      <select id="issue-warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>
        <option value="">Choose a warehouse</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <label htmlFor="issue-bag">To the bag of</label>
      <select id="issue-bag" value={bag} onChange={(e) => setBag(e.target.value)} required>
        <option value="">Choose a rep&apos;s bag</option>
        {bags.map((b) => (
          <option key={b.id} value={b.id}>
            {personName(b.owner_user_id)} · {b.name}
          </option>
        ))}
      </select>
      {lines.map((l, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and have no id of their own
        <div key={n} className="inline-form">
          <label htmlFor={`issue-sku-${n}`}>Issue SKU {n + 1}</label>
          <select id={`issue-sku-${n}`} value={l.sku} onChange={(e) => setLine(n, { sku: e.target.value })}>
            <option value="">Choose a SKU</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
                {s.variant ? ` ${s.variant}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor={`issue-qty-${n}`}>Issue quantity {n + 1}</label>
          <input id={`issue-qty-${n}`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(n, { qty: e.target.value })} />
        </div>
      ))}
      {lines.length < MAX_ISSUE_LINES && (
        <button type="button" className="inline link" onClick={() => setLines((all) => [...all, { sku: "", qty: "" }])}>
          Add a line
        </button>
      )}
      <label htmlFor="issue-note">Note for the rep (optional)</label>
      <input id="issue-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <FormError error={error} />
      <button type="submit" className="inline" disabled={busy}>
        Propose the issue
      </button>
    </form>
  );
}
