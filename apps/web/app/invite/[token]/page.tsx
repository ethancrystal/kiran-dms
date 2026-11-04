"use client";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/browser";

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
const CODE_LENGTH = 6;
const CLOSED: Record<Exclude<Preview["status"], "pending">, string> = {
  redeemed: "This invitation has already been accepted.",
  revoked: "The office withdrew this invitation. Ask them for a new one.",
  expired: "This invitation has expired. Ask the office for a new one.",
};

const DIGITS = "0123456789";
/** What the code box keeps of a paste: "12 34-56" → "123456". */
const digitsOnly = (text: string) => [...text].filter((c) => DIGITS.includes(c)).join("");

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// The one page that creates a login (D-39, spec section 3; every other sign-in page has
// shouldCreateUser false). The invitee confirms the invited email with the 6-digit code; only then
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
      {state.kind === "signed-out" && <EmailCode onSignedIn={load} />}
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
        <p className="error" role="alert">
          {CLOSED[preview.status]}
        </p>
      )}
    </div>
  );
}

function EmailCode({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = () => email.trim().toLowerCase();

  if (!sent) {
    return (
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          // The only shouldCreateUser: true in the app: an invitee has no login yet (D-39).
          const { error: refused } = await supabaseBrowser().auth.signInWithOtp({
            email: address(),
            options: { shouldCreateUser: true },
          });
          setBusy(false);
          if (refused) return setError("Could not send the code. Check the email address or try again shortly.");
          setSent(true);
        }}
      >
        <p>Enter the email address this invitation was sent to. We will email you a 6-digit code.</p>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error: refused } = await supabaseBrowser().auth.verifyOtp({ email: address(), token: code, type: "email" });
        setBusy(false);
        if (refused) return setError("Wrong or expired code.");
        await onSignedIn();
      }}
    >
      <p>We emailed a 6-digit code to {email.trim()}.</p>
      <label htmlFor="code">Code</label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        minLength={CODE_LENGTH}
        maxLength={CODE_LENGTH}
        required
        value={code}
        onChange={(e) => setCode(digitsOnly(e.target.value))}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={() => {
          setSent(false);
          setCode("");
          setError(null);
        }}
      >
        Use a different email
      </button>
    </form>
  );
}
