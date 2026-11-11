"use client";
import { useEffect, useState } from "react";
import { RepMonth } from "@/components/rep-month";
import { deviceId, ensureDeviceRegistered, supabaseBrowser } from "@/lib/supabase/browser";

type Session = {
  full_name: string;
  role: "owner" | "manager" | "rep";
  status: "active" | "suspended" | "offboarded";
  device_status: "pending" | "approved" | "revoked" | null;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unregistered"; code: string }
  | { kind: "salon" }
  | { kind: "ready"; session: Session };

// Rep home. On first open it registers this phone (SEC-03). Until an office user approves
// it, the database shows this session no rows and refuses every action
// (app.rep_device_ok); app.my_session() is the one call that still answers, so the rep
// can see why.
export default function RepHome() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      // Always take the client fresh from supabaseBrowser(): it is rebuilt after a rotation.
      const { data: { user } } = await supabaseBrowser().auth.getUser();
      if (!user) return setState({ kind: "error", message: "Not signed in." });

      const idUsed = deviceId();
      const first = await supabaseBrowser().schema("app").rpc("my_session");
      const s0 = first.data as Session | null;
      if (first.error) return setState({ kind: "error", message: "Could not load your session." });
      if (!s0) {
        // AUTH-07 (P1-30): a salon's login is not "not set up"; it belongs in the salon portal.
        const salon = await supabaseBrowser().schema("app").rpc("salon_me");
        if (!salon.error && salon.data) return setState({ kind: "salon" });
        return setState({ kind: "unregistered", code: user.id });
      }
      if (s0.status !== "active") {
        return setState({ kind: "error", message: "Your account is not active. Contact your manager." });
      }
      if (!s0.device_status || s0.device_status === "revoked") {
        // A revoked id is dead for good (migration 0006): a fresh one is generated and
        // registered once, even if this effect runs twice or two tabs are open.
        const reg = await ensureDeviceRegistered(s0.device_status, idUsed);
        if (reg.error) return setState({ kind: "error", message: "Could not register this phone." });
      }
      const again = await supabaseBrowser().schema("app").rpc("my_session");
      if (again.error || !again.data) return setState({ kind: "error", message: "Could not load your session." });
      setState({ kind: "ready", session: again.data as Session });
    })();
  }, []);

  return (
    <main>
      <h1>Today</h1>
      {state.kind === "loading" && <p className="muted">Loading…</p>}
      {state.kind === "error" && <p className="error" role="alert">{state.message}</p>}
      {state.kind === "salon" && (
        <div className="card">
          <p className="error" role="alert">
            This is a salon&apos;s login, not a rep&apos;s. Your account is in the salon portal.
          </p>
          <p>
            <a className="btn" href="/salon">
              Open the salon portal
            </a>
          </p>
        </div>
      )}
      {state.kind === "unregistered" && (
        <div className="card">
          <p className="error" role="alert">
            Your account is not set up yet. Give this sign-in code to the owner:
          </p>
          <p>
            <code data-testid="signin-code">{state.code}</code>
          </p>
        </div>
      )}
      {state.kind === "ready" && (
        <div className="card">
          <p>Salaam, {state.session.full_name}.</p>
          {state.session.device_status === "approved" ? (
            <p className="ok">This phone is approved.</p>
          ) : (
            <p className="error">
              This phone is waiting for your manager&apos;s approval. You can&apos;t take orders or payments until it is approved.
            </p>
          )}
        </div>
      )}
      {state.kind === "ready" && state.session.device_status === "approved" && <RepMonth />}
      {state.kind === "ready" && state.session.device_status === "approved" && (
        <>
          <a className="btn" href="/app/day">
            Start your day
          </a>
          <p>
            <a href="/app/handovers">
              Cash handover
            </a>
          </p>
          <p>
            <a href="/app/cards">
              My cards
            </a>
          </p>
          <p>
            <a href="/app/orders">
              Orders
            </a>
          </p>
          <p>
            <a href="/app/deliveries">
              My deliveries
            </a>
          </p>
          <p>
            <a href="/app/stock">My bag and incoming stock</a>
          </p>
          <p>
            <a href="/app/route">My route</a>
          </p>
          <p>
            <a href="/app/commission">
              My commission
            </a>
          </p>
          <p>
            <a href="/app/salons">My salons</a>
          </p>
          <p>
            <a href="/app/account">
              My account
            </a>
          </p>
          <p>
            <a href="/app/outbox">Waiting to send</a>
          </p>
        </>
      )}
      {state.kind !== "loading" && (
        <p>
          {/* REP-11 (P1-30): sign out on a phone that is handed on, or from a message this page shows. */}
          <button
            type="button"
            className="inline link"
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              window.location.assign("/app/login");
            }}
          >
            Sign out
          </button>
        </p>
      )}
    </main>
  );
}
