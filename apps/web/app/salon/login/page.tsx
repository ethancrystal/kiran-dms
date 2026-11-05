"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const CODE_LENGTH = 6;
const DIGITS = "0123456789";
/** What the code box keeps of a paste: "12 34-56" → "123456". */
const digitsOnly = (text: string) => [...text].filter((c) => DIGITS.includes(c)).join("");

// Salon sign-in for an account that already exists: email + 6-digit code. shouldCreateUser is false:
// a salon's login is created only by its invitation link (D-39, /invite).
export default function SalonLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const address = () => email.trim().toLowerCase();

  return (
    <main>
      <h1>Salon sign-in</h1>
      {!sent ? (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { error: refused } = await supabaseBrowser().auth.signInWithOtp({
              email: address(),
              options: { shouldCreateUser: false },
            });
            setBusy(false);
            if (refused) return setError("Could not send the code. Check the email or ask the office.");
            setSent(true);
          }}
        >
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
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { error: refused } = await supabaseBrowser().auth.verifyOtp({ email: address(), token: code, type: "email" });
            setBusy(false);
            if (refused) return setError("Wrong or expired code.");
            router.replace("/salon");
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
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
          {/* AUTH-16: a mistyped address is not a dead end; the rep sign-in and the invitation page do the same. */}
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
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
