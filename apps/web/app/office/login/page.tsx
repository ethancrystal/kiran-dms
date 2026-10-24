"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Owner / manager sign-in: email + password, then mandatory TOTP (SEC-02, doc 06 §3).
// There is no sign-up link: office accounts are created by the owner only (H-15).
export default function OfficeLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError("Sign-in failed. Check your email and password.");
    router.replace("/office/mfa");
  }

  return (
    <main>
      <h1>Office sign-in</h1>
      <p className="muted">Owner and manager accounts only.</p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
