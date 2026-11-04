"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { MoneySection } from "@/components/money-section";
import { percent, percentInput, toBasisPoints } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { label, SALON_TYPES } from "@/lib/salons";

const STAGES = ["prospect", "visited", "trial", "active_new", "active_regular", "at_risk", "dormant", "parked", "blocked"];

type Salon = {
  id: string;
  name: string | null;
  type: string;
  stage: string;
  verification_status: string;
  approval_status: string;
  source: string;
  area_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  chairs: number | null;
};
type Area = { id: string; name: string; active: boolean; territory: { name: string } | null };
type Contact = { name: string | null; phone: string };
type Note = { id: string; body: string; created_at: string };
type Visit = { id: string; outcome: string; arrived_at: string; distance_from_pin_m: number | null; notes: string | null };
type Stage = { from_stage: string | null; to_stage: string; trigger: string; reason: string | null; created_at: string };
type Assignment = { rep_id: string | null; rate_bp: number | null; created_at: string; rep: { full_name: string } | null };
type Rep = { id: string; full_name: string };

const REP_LIMIT = 500;

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// One salon for the office (execution map slice 3; SAL-01 edit, SAL-05 history, MAP-02 pin,
// stage override). Reads through office RLS and the app.* history functions; writes through
// app.update_salon (a null field is kept, the pin moves only as a pair, migration 0014) and
// app.office_override_stage (reason required, recorded as a manual stage event).
export default function OfficeSalon({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [salon, setSalon] = useState<Salon | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, c, n, v, st] = await Promise.all([
        rows<Salon>(
          db()
            .from("salon")
            .select("id, name, type, stage, verification_status, approval_status, source, area_id, address, lat, lng, chairs")
            .eq("id", id),
        ),
        rows<Area>(db().from("area").select("id, name, active, territory:territory_id(name)").order("name").limit(2000)),
        rows<Contact>(
          db().from("salon_contact").select("name, phone").eq("salon_id", id).eq("is_primary", true).eq("active", true),
        ),
        rpc<Note[]>("salon_notes", { p_salon_id: id }),
        rpc<Visit[]>("salon_visits", { p_salon_id: id }),
        rpc<Stage[]>("salon_stages", { p_salon_id: id }),
      ]);
      setSalon(s[0] ?? null);
      setAreas(a);
      setContact(c[0] ?? null);
      setNotes(n ?? []);
      setVisits(v ?? []);
      setStages(st ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };

  if (loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (!salon)
    return (
      <>
        <p className="error" role="alert">
          {error ?? "No such salon."}
        </p>
        <Link href="/office/salons">← Salons</Link>
      </>
    );

  return (
    <>
      <p>
        <Link href="/office/salons">← Salons</Link>
      </p>
      <h1>{salon.name ?? "Unnamed salon"}</h1>
      <p className="muted">
        {label(salon.type)} · <span className="badge">{label(salon.stage)}</span> · {label(salon.verification_status)} · source{" "}
        {label(salon.source)} · <span className={`badge ${salon.approval_status}`}>{label(salon.approval_status)}</span>
      </p>
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby="contact-h">
        <h2 id="contact-h">Primary contact</h2>
        <p>{contact ? `${contact.name ?? "No name"} · ${contact.phone}` : "No phone recorded."}</p>
      </section>

      <RepAssignment salonId={id} approved={salon.approval_status === "approved"} onDone={done} />

      <EditForm key={JSON.stringify(salon)} salon={salon} areas={areas} onDone={() => done("Salon updated.")} />

      <MoneySection salonId={id} mode="office" />

      <section className="card" aria-labelledby="stage-h">
        <h2 id="stage-h">Change stage</h2>
        <StageOverride
          key={salon.stage}
          current={salon.stage}
          onConfirm={async (to, reason) => {
            await rpc("office_override_stage", { p_salon_id: id, p_to: to, p_reason: reason });
            await done(`Stage set to ${label(to)}.`);
          }}
        />
      </section>

      <section aria-labelledby="stages-h">
        <h2 id="stages-h">Stage history</h2>
        {stages.length === 0 && <p className="muted">No stage changes recorded.</p>}
        <ul className="plain">
          {stages.map((s) => (
            <li key={`${s.created_at}-${s.to_stage}`}>
              {s.from_stage ? `${label(s.from_stage)} → ` : ""}
              <strong>{label(s.to_stage)}</strong> <span className="muted">({label(s.trigger)})</span> {when(s.created_at)}
              {s.reason && <span className="muted"> · {s.reason}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="visits-h">
        <h2 id="visits-h">Visits</h2>
        {visits.length === 0 ? (
          <p className="muted">No visits yet.</p>
        ) : (
          <ul className="plain">
            {visits.map((v) => (
              <li key={v.id}>
                <span className="badge">{label(v.outcome)}</span> {when(v.arrived_at)}
                {v.distance_from_pin_m !== null && <span className="muted"> · {v.distance_from_pin_m} m from the pin</span>}
                {v.notes && <> · {v.notes}</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="notes-h">
        <h2 id="notes-h">Notes</h2>
        {notes.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="plain">
            {notes.map((n) => (
              <li key={n.id}>
                {n.body} <span className="muted">{when(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function EditForm({ salon, areas, onDone }: { salon: Salon; areas: Area[]; onDone: () => Promise<void> }) {
  const init = () => ({
    name: salon.name ?? "",
    type: salon.type,
    area: salon.area_id,
    address: salon.address ?? "",
    chairs: salon.chairs === null ? "" : String(salon.chairs),
    lat: salon.lat === null ? "" : String(salon.lat),
    lng: salon.lng === null ? "" : String(salon.lng),
  });
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // A null field is kept by app.update_salon, so emptying a recorded value is refused here
  // rather than silently ignored. The pin is a pair: both or neither.
  const was = { name: salon.name, address: salon.address, chairs: salon.chairs, lat: salon.lat, lng: salon.lng };
  const cleared = (Object.keys(was) as (keyof typeof was)[]).filter((k) => was[k] !== null && form[k].trim() === "");
  const halfPin = (form.lat.trim() === "") !== (form.lng.trim() === "");
  const pinChanged = form.lat.trim() !== String(salon.lat ?? "") || form.lng.trim() !== String(salon.lng ?? "");
  // Chairs: a whole number 0 to 200 (the column's check), so a decimal never reaches the integer parameter.
  const badChairs = form.chairs.trim() !== "" && !(/^\d+$/.test(form.chairs.trim()) && Number(form.chairs) <= 200);
  const blocked = cleared.length > 0 || halfPin || badChairs;

  return (
    <form
      className="card"
      aria-labelledby="edit-h"
      onSubmit={async (e) => {
        e.preventDefault();
        if (blocked) return;
        setBusy(true);
        setError(null);
        try {
          await rpc("update_salon", {
            p_id: salon.id,
            p_name: form.name.trim() || null,
            p_type: form.type,
            p_area_id: form.area,
            p_address: form.address.trim() || null,
            p_lat: pinChanged && form.lat.trim() ? Number(form.lat) : null,
            p_lng: pinChanged && form.lng.trim() ? Number(form.lng) : null,
            p_chairs: form.chairs.trim() === "" ? null : Number(form.chairs),
          });
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="edit-h">Edit details</h2>
      <label htmlFor="name">Salon name</label>
      <input id="name" value={form.name} onChange={set("name")} maxLength={120} />
      <label htmlFor="type">Type</label>
      <select id="type" value={form.type} onChange={set("type")}>
        {SALON_TYPES.map((t) => (
          <option key={t} value={t}>
            {label(t)}
          </option>
        ))}
      </select>
      <label htmlFor="area">Area</label>
      <select id="area" value={form.area} onChange={set("area")}>
        {areas
          .filter((a) => a.active || a.id === salon.area_id)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.territory?.name ?? "—"} · {a.name}
            </option>
          ))}
      </select>
      <label htmlFor="address">Address</label>
      <input id="address" value={form.address} onChange={set("address")} maxLength={300} />
      <label htmlFor="chairs">Chairs</label>
      <input
        id="chairs"
        value={form.chairs}
        onChange={set("chairs")}
        type="number"
        inputMode="numeric"
        min={0}
        max={200}
        step={1}
      />
      <label htmlFor="lat">Pin latitude</label>
      <input id="lat" value={form.lat} onChange={set("lat")} type="number" min={-90} max={90} step="0.000001" />
      <label htmlFor="lng">Pin longitude</label>
      <input id="lng" value={form.lng} onChange={set("lng")} type="number" min={-180} max={180} step="0.000001" />
      {badChairs && (
        <p className="error" role="alert">
          Chairs must be a whole number from 0 to 200.
        </p>
      )}
      {halfPin && (
        <p className="error" role="alert">
          A pin needs both latitude and longitude.
        </p>
      )}
      {cleared.length > 0 && (
        <p className="error" role="alert">
          {cleared.map(label).join(", ")} cannot be emptied once recorded. Correct it instead.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || blocked}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function StageOverride({ current, onConfirm }: { current: string; onConfirm: (to: string, reason: string) => Promise<void> }) {
  const [to, setTo] = useState(STAGES.find((s) => s !== current) ?? "prospect");
  return (
    <>
      <label htmlFor="to-stage">New stage</label>
      <select id="to-stage" value={to} onChange={(e) => setTo(e.target.value)}>
        {STAGES.filter((s) => s !== current).map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
      </select>
      <p className="muted">Recorded in the stage history as a manual change with your reason.</p>
      <ConfirmAction label="Change stage" confirmLabel="Set stage" onConfirm={(reason) => onConfirm(to, reason)} />
    </>
  );
}

// D-36, R4: the salon's rep. With a rep set, that rep alone reaches the salon; with none, the reps
// covering its territory do. The rate is stored for commission (slice 5). Latest row wins
// (app.office_assign_salon_rep); a pending or rejected salon is decided on Salon approvals first.
function RepAssignment({
  salonId,
  approved,
  onDone,
}: {
  salonId: string;
  approved: boolean;
  onDone: (m: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState<Assignment | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState("");
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt; a retry after a lost answer is the same change (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        rows<Assignment>(
          db()
            .from("salon_rep_assignment")
            .select("rep_id, rate_bp, created_at, rep:rep_id(full_name)")
            .eq("salon_id", salonId)
            .order("seq", { ascending: false })
            .limit(1),
        ),
        rows<Rep>(
          db()
            .from("user_profile")
            .select("id, full_name")
            .eq("role", "rep")
            .eq("status", "active")
            .order("full_name")
            .limit(REP_LIMIT),
        ),
      ]);
      setCurrent(a[0] ?? null);
      setReps(r);
      setRepId(a[0]?.rep_id ?? "");
      setRate(a[0]?.rate_bp == null ? "" : percentInput(a[0].rate_bp));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [salonId]);
  useEffect(() => {
    void load();
  }, [load]);

  const rateBp = rate.trim() === "" ? null : toBasisPoints(rate);
  const now = current?.rep
    ? `${current.rep.full_name}${current.rate_bp === null ? "" : ` · ${percent(current.rate_bp)}`}`
    : "No direct rep: the reps covering its territory.";

  return (
    <section className="card" aria-labelledby="rep-h">
      <h2 id="rep-h">Rep and commission rate</h2>
      {loading ? (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      ) : (
        <p data-testid="salon-rep">{now}</p>
      )}
      {!approved && <p className="muted">Decide this salon on Salon approvals first.</p>}
      {approved && !loading && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (repId && rate.trim() !== "" && rateBp === null)
              return setError("Enter the rate as a percentage from 0 to 100, for example 2.5.");
            setBusy(true);
            try {
              await rpc("office_assign_salon_rep", {
                p_client_id: clientId,
                p_salon_id: salonId,
                p_rep_id: repId || null,
                p_rate_bp: repId ? rateBp : null,
              });
              setClientId(crypto.randomUUID());
              await load();
              await onDone(repId ? "Rep assigned." : "Direct rep cleared: the territory's reps reach this salon.");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="assign-rep">Rep</label>
          <select id="assign-rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
            <option value="">No direct rep: the reps covering its territory</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
          <label htmlFor="assign-rate">Commission rate, %</label>
          <input
            id="assign-rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={!repId}
            placeholder="2.5"
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save rep"}
          </button>
        </form>
      )}
    </section>
  );
}
