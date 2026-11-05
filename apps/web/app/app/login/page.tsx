"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Rep sign-in: email + 6-digit one-time code (MJ decision L-0101; replaces phone + SMS OTP, which
// needs an SMS provider). The device gate still binds the rep to one approved phone (SEC-03).
// shouldCreateUser is false: every account is created by the owner (H-15).
export default function RepLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setError("Could not send the code. Check the email or ask your manager.");
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    setBusy(false);
    if (error) return setError("Wrong or expired code.");
    router.replace("/app");
  }

  return (
    <main>
      <h1>Sign in</h1>
      {!sent ? (
        <form className="card" onSubmit={send}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <p>We emailed a 6-digit code to {email.trim()}.</p>
          <label htmlFor="code">Code</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="link" disabled={busy} onClick={() => { setSent(false); setCode(""); setError(null); }}>Use a different email</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
