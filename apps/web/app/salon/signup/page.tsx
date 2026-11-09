"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmailCode } from "@/components/email-code";
import { rpc } from "@/lib/rpc";
import { label, SALON_TYPES } from "@/lib/salons";
import { supabaseBrowser } from "@/lib/supabase/browser";

type State = { kind: "loading" } | { kind: "signed-out" } | { kind: "form" } | { kind: "error"; message: string };

// Limits of app.salon_apply (the database checks them again): names 2 to 120 characters, address 5 to 300.
const NAME_MIN = 2;
const NAME_MAX = 120;
const ADDRESS_MIN = 5;
const ADDRESS_MAX = 300;

// Salon sign-up (MJ, 2026-11-09). A salon confirms its email with the 6-digit code, then tells us who it is
// (app.salon_apply). That makes an application, nothing more: the office approves it before the salon can see
// prices or order. Reps are never made here; they are invited. Every refusal shown is the database's.
export default function SalonSignup() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const {
      data: { user },
    } = await supabaseBrowser().auth.getUser();
    if (!user) return setState({ kind: "signed-out" });
    try {
      // A login that already applied, or already has a salon account, goes to its page instead of the form.
      const own = await rpc<{ membership_status: string } | null>("salon_login_status");
      if (own) return router.replace("/salon");
      setState({ kind: "form" });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <h1>Sign up your salon</h1>
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
        <>
          <EmailCode intro="Enter your email address. We will email you a 6-digit code to confirm it." onSignedIn={load} />
          <p className="muted">
            Already have an account? <Link href="/salon/login">Sign in</Link>
          </p>
        </>
      )}
      {state.kind === "form" && <Details onDone={() => router.replace("/salon")} />}
    </main>
  );
}

function Details({ onDone }: { onDone: () => void }) {
  const [salonName, setSalonName] = useState("");
  const [type, setType] = useState("");
  const [contactName, setContactName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt; a retry after a lost answer is the same application (H-08).
  const [clientId] = useState(() => crypto.randomUUID());

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await rpc("salon_apply", {
            p_client_id: clientId,
            p_salon_name: salonName,
            p_contact_name: contactName,
            p_type: type,
            p_address: address,
          });
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p>Tell us about your salon. The office checks every new salon before it can see prices or order.</p>
      <label htmlFor="salon-name">Salon name</label>
      <input
        id="salon-name"
        required
        minLength={NAME_MIN}
        maxLength={NAME_MAX}
        autoComplete="organization"
        value={salonName}
        onChange={(e) => setSalonName(e.target.value)}
      />
      <label htmlFor="salon-type">Type of salon</label>
      <select id="salon-type" required value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">Choose one</option>
        {SALON_TYPES.map((t) => (
          <option key={t} value={t}>
            {label(t)}
          </option>
        ))}
      </select>
      <label htmlFor="contact-name">Your name</label>
      <input
        id="contact-name"
        required
        minLength={NAME_MIN}
        maxLength={NAME_MAX}
        autoComplete="name"
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
      />
      <label htmlFor="salon-address">Salon address</label>
      <input
        id="salon-address"
        required
        minLength={ADDRESS_MIN}
        maxLength={ADDRESS_MAX}
        autoComplete="street-address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send application"}
      </button>
    </form>
  );
}
