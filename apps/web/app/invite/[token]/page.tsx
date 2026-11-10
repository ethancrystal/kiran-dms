"use client";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { EmailCode } from "@/components/email-code";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { when } from "@/lib/time";

type Preview = {
  kind: "rep" | "salon";
  full_name: string;
  invited_by: string;
  salon_name: string | null;
  status: "pending" | "redeemed" | "revoked" | "expired";
  expires_at: string;
};
type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-for-you"; email: string }
  | { kind: "ready"; preview: Preview }
  | { kind: "error"; message: string };

// Where each account lands once the invitation is accepted.
const HOME = { rep: "/app", salon: "/salon" } as const;
const CLOSED: Record<Exclude<Preview["status"], "pending">, string> = {
  redeemed: "This invitation has already been accepted.",
  revoked: "The office withdrew this invitation. Ask them for a new one.",
  expired: "This invitation has expired. Ask the office for a new one.",
};

// One of the two pages that create a login (D-39, spec section 3; the other is the salon sign-up page,
// MJ 2026-11-09; every other sign-in page has shouldCreateUser false). The invitee confirms the invited email with the 6-digit code; only then
// does the database show who invited them for what (app.invitation_preview: nothing runs for anon),
// and accepting redeems the link (app.redeem_invitation), which makes the rep's profile or the salon's
// account. A login that accepts nothing sees nothing (RLS). Every refusal shown is the database's.
export default function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const {
      data: { user },
    } = await supabaseBrowser().auth.getUser();
    if (!user) return setState({ kind: "signed-out" });
    try {
      const preview = await rpc<Preview | null>("invitation_preview", { p_token: token });
      setState(preview ? { kind: "ready", preview } : { kind: "not-for-you", email: user.email ?? "" });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    await load();
  };

  return (
    <main>
      <h1>Your Kiran invitation</h1>
      {state.kind === "loading" && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {state.kind === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "signed-out" && (
        <EmailCode
          intro="Enter the email address this invitation was sent to. We will email you a 6-digit code."
          onSignedIn={load}
        />
      )}
      {state.kind === "not-for-you" && (
        <div className="card">
          <p className="error" role="alert">
            This link is not valid for {state.email || "this login"}. Sign in with the email address the invitation was sent to.
          </p>
          <button type="button" className="inline" onClick={signOut}>
            Use a different email
          </button>
        </div>
      )}
      {state.kind === "ready" && (
        <Details preview={state.preview} token={token} onAccepted={(kind) => router.replace(HOME[kind])} />
      )}
    </main>
  );
}

function Details({
  preview,
  token,
  onAccepted,
}: {
  preview: Preview;
  token: string;
  onAccepted: (kind: Preview["kind"]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = preview.kind === "rep" ? "a sales rep account" : `the salon account of ${preview.salon_name ?? "your salon"}`;

  return (
    <div className="card">
      <p data-testid="invite-details">
        {preview.invited_by} invited {preview.full_name} to {what}.
      </p>
      {preview.status === "pending" ? (
        <>
          <p className="muted">The link works once and expires {when(preview.expires_at)}.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await rpc<{ kind: Preview["kind"] }>("redeem_invitation", { p_token: token });
                onAccepted(r.kind);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Accepting…" : "Accept invitation"}
          </button>
        </>
      ) : (
        <>
          <p className="error" role="alert">
            {CLOSED[preview.status]}
          </p>
          {/* AUTH-16: an accepted invitation points to the account it made, not to a dead end. */}
          {preview.status === "redeemed" && (
            <p>
              <a className="btn" href={HOME[preview.kind]}>
                {preview.kind === "rep" ? "Go to the rep app" : "Go to the salon portal"}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
