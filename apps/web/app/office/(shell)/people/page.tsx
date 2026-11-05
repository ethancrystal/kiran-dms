"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { db, rows, rpc } from "@/lib/rpc";
import { label, SALON_TYPES } from "@/lib/salons";
import { when } from "@/lib/time";

type Invitation = {
  id: string;
  kind: "rep" | "salon";
  email: string;
  full_name: string;
  salon_name: string | null;
  status: "pending" | "redeemed" | "revoked" | "expired";
  expires_at: string;
  invited_by_name: string;
};
type Rep = { id: string; full_name: string; status: "active" | "suspended" | "offboarded" };
type Member = {
  id: string;
  full_name: string;
  email: string;
  status: "active" | "suspended" | "revoked";
  salon: { name: string | null } | null;
};
type SalonOption = { id: string; name: string | null };
type Area = { id: string; name: string; territory: { name: string } | null };
type Created = { id: string; full_name: string; token: string | null };

const LIST_LIMIT = 500;
// app.office_set_member_status and app.office_revoke_invitation take a reason of at least 3 characters.
const REASON_MIN_LENGTH = 3;

// People (D-39; spec section 5): the owner or a manager invites reps and salons, revokes unused links,
// and suspends or reactivates reps and salon accounts. Owners and managers are not invited here; the
// owner adds them on Team, and offboarding stays there too. Every rule is the database's: the
// app.office_* functions decide and their words are shown.
export default function People() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [i, r, m] = await Promise.all([
        rpc<Invitation[]>("office_invitations"),
        rows<Rep>(
          db().from("user_profile").select("id, full_name, status").eq("role", "rep").order("full_name").limit(LIST_LIMIT),
        ),
        rows<Member>(
          db()
            .from("salon_membership")
            .select("id, full_name, email, status, salon:salon_id(name)")
            .order("created_at", { ascending: false })
            .limit(LIST_LIMIT),
        ),
      ]);
      setInvitations(i ?? []);
      setReps(r);
      setMembers(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (kind: "rep" | "salon", id: string, name: string, status: string, reason: string) => {
    await rpc("office_set_member_status", { p_kind: kind, p_member_id: id, p_status: status, p_reason: reason });
    setNotice(`${name} is now ${status}.`);
    await load();
  };

  return (
    <>
      <h1>People</h1>
      <p className="muted">
        Invite reps and salons here. The owner adds managers and offboards people on Team. A person&apos;s role cannot be changed
        in the app.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <InviteForm onInvited={load} />

      <section aria-labelledby="inv-h">
        <h2 id="inv-h">Invitations</h2>
        <ListState loading={loading} error={error} empty={invitations.length === 0} emptyText="No invitations yet." />
        {!loading && !error && invitations.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>For</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Invited by</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td data-label="Name">{i.full_name}</td>
                  <td data-label="Email">{i.email}</td>
                  <td data-label="For">{i.kind === "rep" ? "Rep" : `Salon · ${i.salon_name ?? "Unnamed salon"}`}</td>
                  <td data-label="Status">
                    <span className={`badge ${i.status}`}>{i.status}</span>
                  </td>
                  <td data-label="Expires">{when(i.expires_at)}</td>
                  <td data-label="Invited by">{i.invited_by_name}</td>
                  <td className="actions">
                    {(i.status === "pending" || i.status === "expired") && (
                      <ConfirmAction
                        label="Revoke"
                        confirmLabel="Revoke link"
                        danger
                        reasonMinLength={REASON_MIN_LENGTH}
                        onConfirm={async (reason) => {
                          await rpc("office_revoke_invitation", { p_invitation_id: i.id, p_reason: reason });
                          setNotice(`Revoked the invitation for ${i.full_name}.`);
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
      </section>

      <section aria-labelledby="reps-h">
        <h2 id="reps-h">Reps</h2>
        <ListState loading={loading} error={error} empty={reps.length === 0} emptyText="No reps yet." />
        {!loading && !error && reps.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.id}>
                  <td data-label="Name">{r.full_name}</td>
                  <td data-label="Status">
                    <span className={`badge ${r.status}`}>{r.status}</span>
                  </td>
                  <td className="actions">
                    {r.status === "active" && (
                      <ConfirmAction
                        label="Suspend"
                        confirmLabel="Suspend now"
                        danger
                        onConfirm={(reason) => setStatus("rep", r.id, r.full_name, "suspended", reason)}
                      />
                    )}
                    {r.status === "suspended" && (
                      <ConfirmAction
                        label="Reactivate"
                        onConfirm={(reason) => setStatus("rep", r.id, r.full_name, "active", reason)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="members-h">
        <h2 id="members-h">Salon accounts</h2>
        <ListState loading={loading} error={error} empty={members.length === 0} emptyText="No salon accounts yet." />
        {!loading && !error && members.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Salon</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td data-label="Salon">{m.salon?.name ?? "Unnamed salon"}</td>
                  <td data-label="Name">{m.full_name}</td>
                  <td data-label="Email">{m.email}</td>
                  <td data-label="Status">
                    <span className={`badge ${m.status}`}>{m.status}</span>
                  </td>
                  <td className="actions">
                    {m.status === "active" && (
                      <ConfirmAction
                        label="Suspend"
                        confirmLabel="Suspend now"
                        danger
                        onConfirm={(reason) => setStatus("salon", m.id, m.full_name, "suspended", reason)}
                      />
                    )}
                    {m.status === "suspended" && (
                      <ConfirmAction
                        label="Reactivate"
                        onConfirm={(reason) => setStatus("salon", m.id, m.full_name, "active", reason)}
                      />
                    )}
                    {m.status !== "revoked" && (
                      <ConfirmAction
                        label="Revoke"
                        confirmLabel="Revoke for good"
                        danger
                        onConfirm={(reason) => setStatus("salon", m.id, m.full_name, "revoked", reason)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

const blankSalon = { name: "", type: "ladies_parlor", area: "" };

function InviteForm({ onInvited }: { onInvited: () => Promise<void> }) {
  const [kind, setKind] = useState<"rep" | "salon">("rep");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [salonMode, setSalonMode] = useState<"existing" | "new">("existing");
  const [salonId, setSalonId] = useState("");
  const [newSalon, setNewSalon] = useState(blankSalon);
  const [salons, setSalons] = useState<SalonOption[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per attempt: a retry after a lost answer is the same invitation (H-08). The new salon's
  // id is kept with it, so a retry does not add a second salon.
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [newSalonId, setNewSalonId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const read = async () => {
      try {
        const [s, a] = await Promise.all([
          rows<SalonOption>(
            db()
              .from("salon")
              .select("id, name")
              .eq("approval_status", "approved")
              .order("name", { nullsFirst: false })
              .limit(LIST_LIMIT),
          ),
          rows<Area>(
            db().from("area").select("id, name, territory:territory_id(name)").eq("active", true).order("name").limit(LIST_LIMIT),
          ),
        ]);
        setSalons(s);
        setAreas(a);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    };
    void read();
  }, []);

  const link = created?.token ? `${window.location.origin}/invite/${created.token}` : null;

  return (
    <form
      className="card"
      aria-labelledby="invite-h"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setCreated(null);
        setCopied(false);
        const salon = kind === "salon";
        try {
          const r = await rpc<Created>("office_invite", {
            p_client_id: clientId,
            p_kind: kind,
            p_full_name: name.trim(),
            p_email: email.trim(),
            p_salon_id: salon && salonMode === "existing" ? salonId || null : null,
            p_new_salon_id: salon && salonMode === "new" ? newSalonId : null,
            p_new_salon_name: salon && salonMode === "new" ? newSalon.name.trim() || null : null,
            p_new_salon_type: salon && salonMode === "new" ? newSalon.type : null,
            p_new_salon_area: salon && salonMode === "new" ? newSalon.area || null : null,
          });
          setCreated(r);
          setName("");
          setEmail("");
          setSalonId("");
          setNewSalon(blankSalon);
          setClientId(crypto.randomUUID());
          setNewSalonId(crypto.randomUUID());
          await onInvited();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="invite-h">Invite</h2>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <label htmlFor="invite-kind">Invite a</label>
      <select id="invite-kind" value={kind} onChange={(e) => setKind(e.target.value as "rep" | "salon")}>
        <option value="rep">Sales rep</option>
        <option value="salon">Salon</option>
      </select>
      <label htmlFor="invite-name">{kind === "rep" ? "Rep's full name" : "Salon contact's name"}</label>
      <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
      <label htmlFor="invite-email">Their email</label>
      <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
      {kind === "salon" && (
        <>
          <fieldset>
            <legend>Which salon</legend>
            <label>
              <input type="radio" checked={salonMode === "existing"} onChange={() => setSalonMode("existing")} /> An approved
              salon
            </label>
            <label>
              <input type="radio" checked={salonMode === "new"} onChange={() => setSalonMode("new")} /> A new salon
            </label>
          </fieldset>
          {salonMode === "existing" ? (
            <>
              <label htmlFor="invite-salon">Salon</label>
              <select id="invite-salon" value={salonId} onChange={(e) => setSalonId(e.target.value)} required>
                <option value="">Choose a salon</option>
                {salons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? "Unnamed salon"}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="new-salon-name">New salon's name</label>
              <input
                id="new-salon-name"
                value={newSalon.name}
                onChange={(e) => setNewSalon((s) => ({ ...s, name: e.target.value }))}
                required
                minLength={2}
                maxLength={120}
              />
              <label htmlFor="new-salon-type">Type</label>
              <select
                id="new-salon-type"
                value={newSalon.type}
                onChange={(e) => setNewSalon((s) => ({ ...s, type: e.target.value }))}
              >
                {SALON_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
              <label htmlFor="new-salon-area">Area</label>
              <select
                id="new-salon-area"
                value={newSalon.area}
                onChange={(e) => setNewSalon((s) => ({ ...s, area: e.target.value }))}
                required
              >
                <option value="">Choose an area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.territory?.name ?? "—"} · {a.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Inviting…" : "Create invitation"}
      </button>
      {created && link && (
        <div className="card" data-testid="invite-created">
          <p>
            <strong>Invitation for {created.full_name}.</strong> This link is shown once: copy it now and send it to them. It
            works once and expires in 7 days.
          </p>
          <code data-testid="invite-link">{link}</code>
          <button
            type="button"
            className="inline"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {created && !link && (
        <p className="error" role="alert">
          This invitation was already created and its link was shown once. If the link is lost, revoke it and invite again.
        </p>
      )}
    </form>
  );
}
