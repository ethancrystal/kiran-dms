"use client";
import { useEffect, useState } from "react";
import { deviceId, rotateDeviceId, supabaseBrowser } from "@/lib/supabase/browser";

type Session = {
  full_name: string;
  role: "owner" | "manager" | "rep";
  status: "active" | "suspended" | "offboarded";
  device_status: "pending" | "approved" | "revoked" | null;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: Session };

// Rep home. On first open it registers this phone (SEC-03). Until an office user approves
// it, the database shows this session no rows and refuses every action
// (app.rep_device_ok); app.my_session() is the one call that still answers, so the rep
// can see why.
export default function RepHome() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return setState({ kind: "error", message: "Not signed in." });

      const first = await sb.schema("app").rpc("my_session");
      const s0 = first.data as Session | null;
      if (first.error || !s0) return setState({ kind: "error", message: "Your account is not set up. Contact your manager." });
      if (s0.status !== "active") {
        return setState({ kind: "error", message: "Your account is not active. Contact your manager." });
      }
      let client = sb;
      if (!s0.device_status || s0.device_status === "revoked") {
        // A revoked id is dead for good (migration 0006): generate a fresh one, which the
        // office must approve like any new phone.
        if (s0.device_status === "revoked") {
          rotateDeviceId();
          client = supabaseBrowser();
        }
        const reg = await client.schema("app").rpc("register_device", {
          p_fingerprint: deviceId(),
          p_platform: navigator.userAgent.slice(0, 60),
          p_label: null,
        });
        if (reg.error) return setState({ kind: "error", message: "Could not register this phone." });
      }
      const again = await client.schema("app").rpc("my_session");
      if (again.error || !again.data) return setState({ kind: "error", message: "Could not load your session." });
      setState({ kind: "ready", session: again.data as Session });
    })();
  }, []);

  return (
    <main>
      <h1>Today · <span lang="ur">آج</span></h1>
      {state.kind === "loading" && <p className="muted">Loading…</p>}
      {state.kind === "error" && <p className="error" role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <div className="card">
          <p>Salaam, {state.session.full_name}.</p>
          {state.session.device_status === "approved" ? (
            <p className="ok">This phone is approved.</p>
          ) : (
            <p className="error">
              This phone is waiting for your manager&apos;s approval. You can&apos;t take orders or payments until it is approved.
              <br />
              <span lang="ur">یہ فون مینیجر کی منظوری کا منتظر ہے۔</span>
            </p>
          )}
        </div>
      )}
    </main>
  );
}
