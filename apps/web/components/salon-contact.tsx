"use client";
import { useState } from "react";
import { rpc } from "@/lib/rpc";

const REASON_MIN = 3; // app.assert_reason
const NAME_MAX = 120; // salon_contact.name: 2 to 120 characters
// salon_contact.phone: digits only, 10 to 15 of them, an optional leading +: "+923001234567" and "03001234567"
// match; "0300-1234567" and "12345" do not.
// https://regex101.com/?regex=%5E%5C%2B%3F%5B0-9%5D%7B10%2C15%7D%24&flavor=javascript
export const PHONE = /^\+?[0-9]{10,15}$/;

export type Contact = { name: string | null; phone: string };

// FLOW-16, M3 (P1-30): the salon's primary contact, read through office RLS, changed with a reason
// through app.office_set_primary_contact (the old contact is retired, not deleted; receipts link to the
// contact that was primary when they were issued). The database checks the phone's shape again.
export function SalonContact({
  salonId,
  contact,
  onDone,
}: {
  salonId: string;
  contact: Contact | null;
  onDone: (m: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card" aria-labelledby="contact-h">
      <h2 id="contact-h">Primary contact</h2>
      <p data-testid="primary-contact">{contact ? `${contact.name ?? "No name"} · ${contact.phone}` : "No phone recorded."}</p>
      {!open ? (
        <button type="button" className="inline" onClick={() => setOpen(true)}>
          {contact ? "Change contact" : "Add contact"}
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const p = phone.trim();
            if (!PHONE.test(p)) return setError("Enter the phone as digits only, 10 to 15 of them, for example 03001234567.");
            setBusy(true);
            try {
              await rpc("office_set_primary_contact", {
                p_salon_id: salonId,
                p_name: name.trim() || null,
                p_phone: p,
                p_reason: reason.trim(),
              });
              setOpen(false);
              setPhone("");
              setReason("");
              await onDone("Primary contact saved.");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="contact-name">Contact person&apos;s name</label>
          <input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} />
          <label htmlFor="contact-phone">Contact phone</label>
          <input
            id="contact-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <label htmlFor="contact-reason">Why change the contact</label>
          <input
            id="contact-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={REASON_MIN}
            maxLength={300}
            required
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save contact"}
            </button>
            <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
