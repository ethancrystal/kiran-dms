"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { db, mySession, type Role, rows, rpc, type Session } from "@/lib/rpc";

type Person = {
  id: string;
  full_name: string;
  role: Role;
  status: "active" | "suspended" | "offboarded";
  phone: string | null;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// People and their status. Doc 06 §2: users are governance, owner-only at AAL2 (H-15); a manager
// sees the list but no controls, and the database refuses the calls anyway. A person first signs
// in once (office: password; rep: email code), sees their sign-in code, and gives it to the owner,
// who adds their profile here (app.owner_create_user). Self-signup is off (supabase/config.toml).
export default function Team() {
  const [me, setMe] = useState<Session | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, p] = await Promise.all([
        mySession(),
        rows<Person>(
          db().from("user_profile").select("id, full_name, role, status, phone, created_at").order("full_name").limit(500),
        ),
      ]);
      setMe(s);
      setPeople(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = me?.role === "owner";
  const setStatus = async (p: Person, status: Person["status"], reason: string) => {
    await rpc("owner_set_status", { p_user_id: p.id, p_status: status, p_reason: reason });
    setNotice(`${p.full_name} is now ${status}.`);
    await load();
  };

  return (
    <>
      <h1>Team</h1>
      {!isOwner && me && <p className="muted">Only the owner adds people or changes their status (doc 06 §2).</p>}
      {notice && <output className="ok">{notice}</output>}
      {isOwner && (
        <AddPerson
          onAdded={async (name) => {
            setNotice(`Added ${name}.`);
            await load();
          }}
        />
      )}
      <ListState loading={loading} error={error} empty={people.length === 0} emptyText="No people yet." />
      {!loading && !error && people.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Phone</th>
              {isOwner && <th>Action</th>}
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
                <td>{p.phone ?? "—"}</td>
                {isOwner && (
                  <td className="actions">
                    {p.role !== "owner" && p.status === "active" && (
                      <ConfirmAction
                        label="Suspend"
                        confirmLabel="Suspend now"
                        danger
                        onConfirm={(r) => setStatus(p, "suspended", r)}
                      />
                    )}
                    {p.role !== "owner" && p.status === "suspended" && (
                      <ConfirmAction label="Reactivate" onConfirm={(r) => setStatus(p, "active", r)} />
                    )}
                    {p.role !== "owner" && p.status !== "offboarded" && (
                      <ConfirmAction
                        label="Offboard"
                        confirmLabel="Offboard for good"
                        danger
                        onConfirm={(r) => setStatus(p, "offboarded", r)}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AddPerson({ onAdded }: { onAdded: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("rep");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="inline" onClick={() => setOpen(true)}>
        Add a person
      </button>
    );
  }
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!UUID.test(code.trim())) return setError("The sign-in code is the long code the person sees after signing in once.");
        setBusy(true);
        try {
          await rpc("owner_create_user", {
            p_user_id: code.trim(),
            p_full_name: name.trim(),
            p_role: role,
            p_phone: phone.trim() || null,
          });
          setOpen(false);
          setCode("");
          setName("");
          setPhone("");
          await onAdded(name.trim());
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Add a person</h2>
      <p className="muted">Ask them to sign in once; the page then shows their sign-in code.</p>
      <label htmlFor="code">Sign-in code</label>
      <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" spellCheck={false} />
      <label htmlFor="name">Full name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
      <label htmlFor="role">Role</label>
      <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="rep">Sales rep</option>
        <option value="manager">Manager</option>
      </select>
      <label htmlFor="phone">Mobile (optional)</label>
      <input
        id="phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        inputMode="tel"
        pattern="\+?[0-9]{10,15}"
        placeholder="+92…"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Adding…" : "Add person"}
        </button>
        <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
