"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { label, position, SALON_TYPES } from "@/lib/salons";

type AreaRow = { territory_id: string; territory_name: string; area_id: string; area_name: string };

// Add a salon (J2; SAL-01, MAP-02, PIP-07). The pin is the phone's GPS when it allows it, never a
// guessed point. The id is made here once, so a double tap or a retry is the same salon
// (app.create_salon is idempotent on it). The database checks territory, duplicates and stage.
export default function NewSalon() {
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [id] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ name: "", type: "ladies_parlor", area: "", address: "", contact: "", phone: "", note: "" });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinState, setPinState] = useState<"none" | "asking" | "refused">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc<AreaRow[]>("my_areas")
      .then((a) => {
        setAreas(a ?? []);
        if (a?.[0]) setForm((f) => ({ ...f, area: f.area || a[0].area_id }));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main>
      <h1>
        Add a salon · <span lang="ur">نیا سیلون</span>
      </h1>
      <p>
        <a href="/app/salons">← Salons</a>
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await rpc("create_salon", {
              p_id: id,
              p_name: form.name.trim() || null,
              p_type: form.type,
              p_area_id: form.area,
              p_source: pin ? "map_pin" : "manual",
              p_address: form.address.trim() || null,
              p_lat: pin?.lat ?? null,
              p_lng: pin?.lng ?? null,
              p_chairs: null,
              p_contact_name: form.contact.trim() || null,
              p_contact_phone: form.phone.trim() || null,
              p_note: form.note.trim() || null,
              p_created_at_client: new Date().toISOString(),
            });
            window.location.assign(`/app/salons/${id}`);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
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
        {areas.length === 0 ? (
          <p className="error">No area is assigned to you, so you cannot add a salon yet. Ask your manager.</p>
        ) : (
          <select id="area" value={form.area} onChange={set("area")} required>
            {areas.map((a) => (
              <option key={a.area_id} value={a.area_id}>
                {a.territory_name} · {a.area_name}
              </option>
            ))}
          </select>
        )}
        <label htmlFor="address">Address (optional)</label>
        <input id="address" value={form.address} onChange={set("address")} maxLength={300} />
        <div className="card">
          <strong>Pin</strong>{" "}
          {pin ? (
            <span className="ok">
              {pin.lat}, {pin.lng}
            </span>
          ) : (
            <span className="muted">{pinState === "refused" ? "The phone did not give a location." : "No pin yet."}</span>
          )}
          <button
            type="button"
            className="inline"
            disabled={pinState === "asking"}
            onClick={async () => {
              setPinState("asking");
              const p = await position();
              setPin(p);
              setPinState(p ? "none" : "refused");
            }}
          >
            {pinState === "asking" ? "Finding you…" : "Use my location"}
          </button>
        </div>
        <label htmlFor="contact">Contact name (optional)</label>
        <input id="contact" value={form.contact} onChange={set("contact")} maxLength={120} />
        <label htmlFor="phone">Contact mobile (optional)</label>
        <input
          id="phone"
          value={form.phone}
          onChange={set("phone")}
          inputMode="tel"
          pattern="\+?[0-9]{10,15}"
          placeholder="03XX…"
        />
        <label htmlFor="note">First note (optional)</label>
        <input id="note" value={form.note} onChange={set("note")} maxLength={1000} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || areas.length === 0}>
          {busy ? "Saving…" : "Add salon"}
        </button>
      </form>
    </main>
  );
}
