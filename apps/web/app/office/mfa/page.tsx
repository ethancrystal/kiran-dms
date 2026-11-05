"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SignOut } from "../(shell)/sign-out";

type Factor = { id: string; status: string; factor_type: string };

type Step =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "elsewhere"; message: string; href: string; link: string };

// Mandatory TOTP for owner/manager (SEC-02). First visit enrols an authenticator app;
// later visits verify a 6-digit code. The database refuses office powers without AAL2.
export default function OfficeMfa() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return router.replace("/office");
      // AUTH-06 (P1-30): a rep's or a salon's login needs no authenticator; send it to its own area
      // instead of enrolling a factor it will never use. A login with no profile still enrols, so a new
      // manager can reach the sign-in code the owner needs (Team, "Add a person").
      const me = await sb.schema("app").rpc("my_session");
      const role = (me.data as { role?: string } | null)?.role;
      if (role === "rep")
        return setStep({
          kind: "elsewhere",
          message: "This is a rep's login. The office is for the owner and managers; your work is in the field app.",
          href: "/app",
          link: "Open the field app",
        });
      if (!me.error && !me.data) {
        const salon = await sb.schema("app").rpc("salon_me");
        if (!salon.error && salon.data)
          return setStep({
            kind: "elsewhere",
            message: "This is a salon's login. The office is for the owner and managers; your account is in the salon portal.",
            href: "/salon",
            link: "Open the salon portal",
          });
      }
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) return setError("Could not load your authenticator settings. Sign in again.");
      const verified = (data.totp as Factor[]).find((f) => f.status === "verified");
      if (verified) return setStep({ kind: "verify", factorId: verified.id });
      // Clean up abandoned, unverified enrolments before starting a new one.
      for (const f of (data.all as Factor[]).filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
        await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const en = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Kiran office" });
      if (en.error) return setError("Could not start authenticator setup.");
      setStep({ kind: "enroll", factorId: en.data.id, qr: en.data.totp.qr_code, secret: en.data.totp.secret });
    })();
  }, [router]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "enroll" && step.kind !== "verify") return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: step.factorId, code });
    setBusy(false);
    if (error) return setError("That code did not match. Try the current code from your authenticator app.");
    router.replace("/office");
    router.refresh();
  }

  return (
    <main>
      <h1>Two-step verification</h1>
      {step.kind === "loading" && !error && <p className="muted">Loading…</p>}
      {step.kind === "enroll" && (
        <div className="card">
          <p>Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={step.qr} width={180} height={180} alt="Authenticator QR code" />
          <p className="muted">Can&apos;t scan? Enter this key: <code>{step.secret}</code></p>
          <p className="muted">
            Write this key down and keep it somewhere safe offline. If you lose the phone, the owner can reset your authenticator
            (see the owner&apos;s runbook).
          </p>
        </div>
      )}
      {step.kind === "elsewhere" && (
        <div className="card">
          <p className="error" role="alert">
            {step.message}
          </p>
          <p>
            <a className="btn" href={step.href}>
              {step.link}
            </a>
          </p>
        </div>
      )}
      {(step.kind === "enroll" || step.kind === "verify") && (
        <form className="card" onSubmit={verify}>
          <label htmlFor="code">6-digit code</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {step.kind !== "loading" && <SignOut />}
    </main>
  );
}
