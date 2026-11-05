"use client";
import { useEffect, useState } from "react";
import { RepSignOut } from "@/components/rep-sign-out";
import { mySession, type Session } from "@/lib/rpc";

const STATUS_TEXT: Record<Session["status"], string> = {
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};
const DEVICE_TEXT: Record<NonNullable<Session["device_status"]>, string> = {
  pending: "Waiting for your manager's approval",
  approved: "Approved",
  revoked: "Revoked",
};

// The rep's account, read-only (goal: "only guarded account info ... which they cannot change or edit
// anything"; spec section 5). app.my_session is the only read; nothing here writes. Changes go
// through the manager.
export default function MyAccount() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSession(await mySession());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My account</h1>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !session && <p className="error">This login has no rep account.</p>}
      {session && (
        <div className="card">
          <dl>
            <dt>Name</dt>
            <dd data-testid="account-name">{session.full_name}</dd>
            <dt>Role</dt>
            <dd>{session.role}</dd>
            <dt>Account</dt>
            <dd>{STATUS_TEXT[session.status]}</dd>
            <dt>This phone</dt>
            <dd>{session.device_status ? DEVICE_TEXT[session.device_status] : "Not registered"}</dd>
          </dl>
          <p className="muted">You cannot change these details here. Ask your manager for any change.</p>
          <p>
            <a href="/app/commission">My commission</a>
          </p>
        </div>
      )}
      <p>
        <RepSignOut />
      </p>
    </main>
  );
}
