"use client";
import { use, useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { findSalon, label, SALON_TYPES, type SalonDetail } from "@/lib/salons";

type AreaRow = { territory_id: string; territory_name: string; area_id: string; area_name: string };

// Edit a salon (SAL-01; execution map slice 3). The form starts from the database's values
// (app.my_salon) and saves through app.update_salon, which checks the territory of both the salon
// and the new area. A field the form sends as null is kept (migration 0014), so a field cannot be
// emptied here. The pin is not offered: whether a rep may move a pin is open (B-31 a), so the
// form never sends lat or lng and the office moves pins.
export default function EditSalon({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [form, setForm] = useState({ name: "", type: "", area: "", address: "", chairs: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([findSalon(id), rpc<AreaRow[]>("my_areas")])
      .then(([s, a]) => {
        setSalon(s);
        setAreas(a ?? []);
        if (s)
          setForm({
            name: s.name ?? "",
            type: s.type,
            area: s.area_id,
            address: s.address ?? "",
            chairs: s.chairs === null ? "" : String(s.chairs),
          });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (loading)
    return (
      <main>
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      </main>
    );
  if (!salon)
    return (
      <main>
        <p className="error" role="alert">
          {error ?? "This salon is not in your territory."}
        </p>
        <a href="/app/salons">← Salons</a>
      </main>
    );

  // Emptying a field would silently keep the old value (null means keep), so it is refused here.
  const cleared = (
    [
      ["name", salon.name],
      ["address", salon.address],
      ["chairs", salon.chairs],
    ] as const
  )
    .filter(([k, was]) => was !== null && form[k].trim() === "")
    .map(([k]) => k);

  return (
    <main>
      <p>
        <a href={`/app/salons/${id}`}>← {salon.name ?? "Unnamed salon"}</a>
      </p>
      <h1>
        Edit salon · <span lang="ur">سیلون میں تبدیلی</span>
      </h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (cleared.length > 0) return;
          setBusy(true);
          setError(null);
          try {
            await rpc("update_salon", {
              p_id: id,
              p_name: form.name.trim() || null,
              p_type: form.type,
              p_area_id: form.area,
              p_address: form.address.trim() || null,
              p_lat: null,
              p_lng: null,
              p_chairs: form.chairs.trim() === "" ? null : Number(form.chairs),
            });
            window.location.assign(`/app/salons/${id}?saved=1`);
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
        <select id="area" value={form.area} onChange={set("area")} required>
          {areas.map((a) => (
            <option key={a.area_id} value={a.area_id}>
              {a.territory_name} · {a.area_name}
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
        <p className="muted">
          Pin: {salon.lat !== null && salon.lng !== null ? `${salon.lat}, ${salon.lng}` : "not set"}. To move the pin, ask the
          office.
        </p>
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
        <button type="submit" disabled={busy || cleared.length > 0}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </main>
  );
}
