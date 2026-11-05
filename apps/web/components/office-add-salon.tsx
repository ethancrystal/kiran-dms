"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PHONE } from "@/components/salon-contact";
import { db, rows, rpc } from "@/lib/rpc";
import { label, SALON_TYPES } from "@/lib/salons";

type Area = { id: string; name: string; territory: { name: string } | null };

const AREA_LIMIT = 2000;
const NAME_MAX = 120;
const ADDRESS_MAX = 300;

// M11 (P1-30): the office adds a salon that has no portal login (D-35: a salon the office adds is
// approved at once). app.create_salon with the office's session, source "manual", an id made here so a
// retry after a lost answer is the same salon (H-08). A portal login comes later, by invitation on People.
export function OfficeAddSalon() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [form, setForm] = useState({ name: "", type: "ladies_parlor", area: "", address: "", contact: "", phone: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const go = async () => {
      try {
        setAreas(
          await rows<Area>(
            db().from("area").select("id, name, territory:territory_id(name)").eq("active", true).order("name").limit(AREA_LIMIT),
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void go();
  }, [open]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!open)
    return (
      <button type="button" className="inline" onClick={() => setOpen(true)}>
        Add a salon
      </button>
    );
  return (
    <form
      className="card"
      aria-labelledby="add-salon-h"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!form.area) return setError("Choose the area.");
        const phone = form.phone.trim();
        if (phone && !PHONE.test(phone))
          return setError("Enter the phone as digits only, 10 to 15 of them, for example 03001234567, or leave it empty.");
        setBusy(true);
        try {
          await rpc("create_salon", {
            p_id: key,
            p_name: form.name.trim(),
            p_type: form.type,
            p_area_id: form.area,
            p_source: "manual",
            p_address: form.address.trim() || null,
            p_contact_name: phone ? form.contact.trim() || null : null,
            p_contact_phone: phone || null,
          });
          const made = key;
          setKey(crypto.randomUUID());
          router.push(`/office/salons/${made}`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="add-salon-h">Add a salon</h2>
      <p className="muted">
        For a salon with no portal login. It is approved at once. Invite it on People later if it should order online.
      </p>
      <label htmlFor="new-salon-name">New salon&apos;s name</label>
      <input id="new-salon-name" value={form.name} onChange={set("name")} maxLength={NAME_MAX} required />
      <label htmlFor="new-salon-type">New salon&apos;s type</label>
      <select id="new-salon-type" value={form.type} onChange={set("type")}>
        {SALON_TYPES.map((t) => (
          <option key={t} value={t}>
            {label(t)}
          </option>
        ))}
      </select>
      <label htmlFor="new-salon-area">New salon&apos;s area</label>
      <select id="new-salon-area" value={form.area} onChange={set("area")} required>
        <option value="">Choose an area</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.territory?.name ?? "—"} · {a.name}
          </option>
        ))}
      </select>
      <label htmlFor="new-salon-address">New salon&apos;s address</label>
      <input id="new-salon-address" value={form.address} onChange={set("address")} maxLength={ADDRESS_MAX} />
      <label htmlFor="new-salon-contact">Contact person (optional)</label>
      <input id="new-salon-contact" value={form.contact} onChange={set("contact")} maxLength={NAME_MAX} />
      <label htmlFor="new-salon-phone">Contact phone (optional)</label>
      <input id="new-salon-phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add salon"}
        </button>
        <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
