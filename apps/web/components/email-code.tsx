"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const CODE_LENGTH = 6;
const DIGITS = "0123456789";
/** What the code box keeps of a paste: "12 34-56" → "123456". */
const digitsOnly = (text: string) => [...text].filter((c) => DIGITS.includes(c)).join("");

// Email + 6-digit code, for the two pages that create a login: the invitation page (D-39) and the salon
// sign-up page (MJ, 2026-11-09). Every other sign-in page keeps shouldCreateUser false. The code proves the
// mailbox: the database accepts an invitation or a sign-up only from a session that signed in with it.
export function EmailCode({ intro, onSignedIn }: { intro: string; onSignedIn: () => Promise<void> }) {
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
          // shouldCreateUser: true is allowed on exactly the pages that use this component: the person has no login yet.
          const { error: refused } = await supabaseBrowser().auth.signInWithOtp({
            email: address(),
            options: { shouldCreateUser: true },
          });
          setBusy(false);
          if (refused) return setError("Could not send the code. Check the email address or try again shortly.");
          setSent(true);
        }}
      >
        <p>{intro}</p>
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
