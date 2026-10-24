"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Rep sign-in: phone number + SMS OTP (SEC-03). Numbers are entered in Pakistani format
// and normalised to E.164 (+92…).
function toE164(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.startsWith("92")) return `+${d}`;
  if (d.startsWith("0")) return `+92${d.slice(1)}`;
  return `+92${d}`;
}

export default function RepLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ phone: toE164(phone), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setError("Could not send the code. Check the number or ask your manager.");
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ phone: toE164(phone), token: code, type: "sms" });
    setBusy(false);
    if (error) return setError("Wrong or expired code.");
    router.replace("/app");
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p className="ur" lang="ur">سائن اِن</p>
      {!sent ? (
        <form className="card" onSubmit={send}>
          <label htmlFor="phone">Mobile number · <span lang="ur">موبائل نمبر</span></label>
          <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="03xx xxxxxxx" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button disabled={busy}>{busy ? "Sending…" : "Send code · کوڈ بھیجیں"}</button>
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <label htmlFor="code">Code · <span lang="ur">کوڈ</span></label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy}>{busy ? "Checking…" : "Sign in · سائن اِن"}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
