"use client";
import { useEffect, useState } from "react";
import { deviceId, supabaseBrowser } from "@/lib/supabase/browser";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; name: string; deviceStatus: "pending" | "approved" | "revoked" };

// Rep home. On first open it registers this phone (SEC-03); until an office user approves
// it, the database refuses every rep action from it (app.rep_device_ok).
export default function RepHome() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return setState({ kind: "error", message: "Not signed in." });
      const { data: profile } = await sb.from("user_profile").select("full_name, role, status").eq("id", user.id).maybeSingle();
      if (!profile || profile.status !== "active") {
        return setState({ kind: "error", message: "Your account is not active. Contact your manager." });
      }
      const { data: device, error } = await sb.schema("app").rpc("register_device", {
        p_fingerprint: deviceId(),
        p_platform: navigator.userAgent.slice(0, 60),
        p_label: null,
      });
      if (error || !device) return setState({ kind: "error", message: "Could not register this phone." });
      setState({ kind: "ready", name: profile.full_name, deviceStatus: device.status });
    })();
  }, []);

  return (
    <main>
      <h1>Today · <span lang="ur">آج</span></h1>
      {state.kind === "loading" && <p className="muted">Loading…</p>}
      {state.kind === "error" && <p className="error" role="alert">{state.message}</p>}
      {state.kind === "ready" && (
        <div className="card">
          <p>Salaam, {state.name}.</p>
          {state.deviceStatus === "approved" ? (
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
