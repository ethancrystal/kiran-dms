"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { db, rows, rpc } from "@/lib/rpc";
import { whenOrDash } from "@/lib/time";

type Device = {
  id: string;
  user_id: string;
  platform: string | null;
  label: string | null;
  status: "pending" | "approved" | "revoked";
  created_at: string;
  approved_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
};
type Person = { id: string; full_name: string; role: string; status: string };

const when = whenOrDash;

// SEC-03: a rep's phone works only after an office user approves it. A revoked id is dead for
// good (migration 0006); the phone registers a fresh one. Nobody approves their own device
// (device_not_self_approved). The database enforces all of it; this page lists and asks.
export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, p] = await Promise.all([
        rows<Device>(
          db()
            .from("device")
            .select("id, user_id, platform, label, status, created_at, approved_at, revoked_at, last_seen_at")
            .order("created_at", { ascending: false })
            .limit(500),
        ),
        rows<Person>(db().from("user_profile").select("id, full_name, role, status").limit(500)),
      ]);
      setDevices(d);
      setPeople(Object.fromEntries(p.map((x) => [x.id, x])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: "approve_device" | "revoke_device", d: Device, reason: string) => {
    await rpc(fn, { p_device_id: d.id, p_reason: reason });
    const who = people[d.user_id]?.full_name ?? "this person";
    setNotice(fn === "approve_device" ? `Approved ${who}'s phone.` : `Revoked ${who}'s phone.`);
    await load();
  };

  const pending = devices.filter((d) => d.status === "pending");
  const approved = devices.filter((d) => d.status === "approved");
  const revoked = devices.filter((d) => d.status === "revoked");
  const name = (d: Device) => people[d.user_id]?.full_name ?? "Unknown person";

  return (
    <>
      <h1>Devices</h1>
      <p className="muted">
        A phone can take orders or payments only after you approve it. Approving a new phone retires the person&apos;s previous
        one.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={false} emptyText="" />

      {!loading && !error && (
        <>
          <section aria-labelledby="pending-h">
            <h2 id="pending-h">Waiting for approval ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="muted">No phone is waiting.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Phone</th>
                    <th>Asked</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((d) => (
                    <tr key={d.id} data-testid={`device-${d.id}`}>
                      <td>{name(d)}</td>
                      <td>{d.label ?? d.platform ?? "—"}</td>
                      <td>{when(d.created_at)}</td>
                      <td className="actions">
                        <ConfirmAction
                          label="Approve"
                          reasonLabel="Note (optional)"
                          reasonRequired={false}
                          onConfirm={(r) => act("approve_device", d, r)}
                        />
                        <ConfirmAction
                          label="Reject"
                          confirmLabel="Reject phone"
                          danger
                          onConfirm={(r) => act("revoke_device", d, r)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="approved-h">
            <h2 id="approved-h">Approved ({approved.length})</h2>
            {approved.length === 0 ? (
              <p className="muted">No approved phones yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Phone</th>
                    <th>Approved</th>
                    <th>Last seen</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map((d) => (
                    <tr key={d.id}>
                      <td>{name(d)}</td>
                      <td>{d.label ?? d.platform ?? "—"}</td>
                      <td>{when(d.approved_at)}</td>
                      <td>{when(d.last_seen_at)}</td>
                      <td className="actions">
                        <ConfirmAction
                          label="Revoke"
                          confirmLabel="Revoke phone"
                          danger
                          onConfirm={(r) => act("revoke_device", d, r)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="revoked-h">
            <h2 id="revoked-h">Revoked ({revoked.length})</h2>
            <button type="button" className="inline link" onClick={() => setShowRevoked((v) => !v)} aria-expanded={showRevoked}>
              {showRevoked ? "Hide" : "Show"} revoked phones
            </button>
            {showRevoked && revoked.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Phone</th>
                    <th>Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {revoked.map((d) => (
                    <tr key={d.id}>
                      <td>{name(d)}</td>
                      <td>{d.label ?? d.platform ?? "—"}</td>
                      <td>{when(d.revoked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}
