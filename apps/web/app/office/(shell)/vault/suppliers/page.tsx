"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { db, mySession, rows, vaultRpc } from "@/lib/rpc";

// The classified compartment (doc 07, P1-05). Everything here arrives from vault_api: the schema has
// no grant for any application role, and each function checks the vault grant and AAL2 in the
// database. This page never decides access; it reports the database's answer.
//
// VLT-04: every vault call carries a purpose. A read names the screen; a write and a grant change ask
// the person for a reason, which the database refuses below three characters.

type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type Person = {
  id: string;
  full_name: string;
  role: "owner" | "manager";
  status: "active" | "suspended" | "offboarded";
  vault_grant: boolean;
};

const READ_PURPOSE = "supplier directory screen";

export default function VaultSuppliers() {
  const [role, setRole] = useState<"owner" | "manager" | "rep" | null>(null);
  const [list, setList] = useState<SupplierRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const session = await mySession();
      setRole(session?.role ?? null);
      // The refused read is the real answer for a manager without a grant: show it, do not hide it
      // behind an empty table.
      const suppliers = await vaultRpc<SupplierRow[]>("supplier_list", { p_purpose: READ_PURPOSE });
      setList(suppliers ?? []);
      if (session?.role === "owner") {
        setPeople(
          await rows<Person>(
            db()
              .from("user_profile")
              .select("id, full_name, role, status, vault_grant")
              .in("role", ["owner", "manager"])
              .order("full_name")
              .limit(200),
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = role === "owner";

  return (
    <>
      <h1>Supplier vault</h1>
      <div className="card">
        <strong>This data is secret.</strong>
        <p className="muted">
          Names, contacts and terms on this screen are the classified supplier. Do not copy them into a note, a message, a
          document, a screenshot or a commit. Every read and every change is written to the vault access log, and a refused call
          is shown as it comes from the database.
        </p>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}

      {isOwner && !loading && !error && (
        <AddSupplier
          onAdded={async (name) => {
            setNotice(`Added ${name}.`);
            await load();
          }}
        />
      )}

      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No supplier is recorded yet." />
      {!error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Note</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.contact_name ?? "—"}</td>
                <td>{s.phone ?? "—"}</td>
                <td>{s.note ?? "—"}</td>
                <td>
                  <span className={`badge ${s.status === "active" ? "active" : ""}`}>{s.status}</span>
                </td>
                <td className="actions">
                  <EditSupplier
                    row={s}
                    onSaved={async (what) => {
                      setNotice(what);
                      await load();
                    }}
                  />
                  {s.status === "active" && (
                    <ConfirmAction
                      label="Archive"
                      confirmLabel="Archive this record"
                      danger
                      onConfirm={async (reason) => {
                        await vaultRpc("supplier_upsert", {
                          p_client_id: crypto.randomUUID(),
                          p_id: s.id,
                          p_name: s.name,
                          p_status: "archived",
                          p_purpose: reason,
                        });
                        setNotice(`Archived ${s.name}.`);
                        await load();
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isOwner && people.length > 0 && (
        <section className="card">
          <h2>Who may open the vault</h2>
          <p className="muted">
            The owner always has access. A manager needs a grant (on by default, VLT-06). Revoking one takes effect on the
            manager's next call and takes nothing else away. Only the owner changes this (H-15).
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Vault access</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.full_name}</td>
                  <td>{p.role}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{p.status}</span>
                  </td>
                  <td>{p.vault_grant ? "granted" : "not granted"}</td>
                  <td className="actions">
                    {p.role === "manager" && p.status === "active" && (
                      <ConfirmAction
                        label={p.vault_grant ? "Revoke" : "Grant"}
                        confirmLabel={p.vault_grant ? "Revoke access" : "Grant access"}
                        danger={p.vault_grant}
                        reasonLabel="Reason"
                        onConfirm={async (reason) => {
                          await vaultRpc("supplier_grant_set", {
                            p_client_id: crypto.randomUUID(),
                            p_user_id: p.id,
                            p_grant: !p.vault_grant,
                            p_purpose: reason,
                          });
                          setNotice(`${p.full_name} is now ${p.vault_grant ? "without" : "with"} vault access.`);
                          await load();
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function AddSupplier({ onAdded }: { onAdded: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="inline" onClick={() => setOpen(true)}>
        Add a record
      </button>
    );
  }
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await vaultRpc("supplier_upsert", {
            p_client_id: key,
            p_id: null,
            p_name: name.trim(),
            p_contact_name: contact.trim(),
            p_phone: phone.trim(),
            p_note: note.trim(),
            p_status: "active",
            p_purpose: reason.trim(),
          });
          setOpen(false);
          setName("");
          setContact("");
          setPhone("");
          setNote("");
          setReason("");
          setKey(crypto.randomUUID());
          await onAdded(name.trim());
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Add a record</h2>
      <label htmlFor="vault-name">Name</label>
      <input
        id="vault-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={1}
        maxLength={120}
        autoComplete="off"
      />
      <label htmlFor="vault-contact">Contact person (optional)</label>
      <input id="vault-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} autoComplete="off" />
      <label htmlFor="vault-phone">Phone (optional)</label>
      <input
        id="vault-phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        maxLength={40}
        inputMode="tel"
        autoComplete="off"
      />
      <label htmlFor="vault-note">Note (optional)</label>
      <input id="vault-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <label htmlFor="vault-reason">Reason for this change</label>
      <input
        id="vault-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={3}
        maxLength={200}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : "Save record"}
        </button>
        <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditSupplier({ row, onSaved }: { row: SupplierRow; onSaved: (what: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(row.name);
  const [contact, setContact] = useState(row.contact_name ?? "");
  const [phone, setPhone] = useState(row.phone ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="inline" onClick={() => setOpen(true)}>
        Edit
      </button>
    );
  }
  return (
    <form
      className="confirm"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await vaultRpc("supplier_upsert", {
            p_client_id: key,
            p_id: row.id,
            p_name: name.trim(),
            p_contact_name: contact.trim(),
            p_phone: phone.trim(),
            p_note: note.trim(),
            p_purpose: reason.trim(),
          });
          setOpen(false);
          setReason("");
          setKey(crypto.randomUUID());
          await onSaved(`Updated ${name.trim()}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={120} />
      </label>
      <label>
        Contact person
        <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" />
      </label>
      <label>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </label>
      <label>
        Reason
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
          maxLength={200}
          aria-label="Reason"
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
