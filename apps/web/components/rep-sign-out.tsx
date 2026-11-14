"use client";
import { useState } from "react";
import { signOutRep } from "@/lib/outbox";
import { type SignOutOutcome, signOutQuestion } from "@/lib/outbox/sign-out";

// REP-11 (P1-30): ends this phone's session and goes back to the sign-in page. The phone's device id
// stays, so the same approved phone signs in again without a new approval.
// P1-09 (plan task 10): what the outbox keeps on the phone is wiped first. Unsent work is never
// dropped silently: with anything unsent the rep is asked, with the count, and Cancel keeps it all.
export function RepSignOut() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SignOutOutcome | null>(null);

  const run = async (discardUnsent: boolean) => {
    setBusy(true);
    let result: SignOutOutcome;
    try {
      result = await signOutRep(discardUnsent);
    } catch (e) {
      result = { kind: "failed", message: (e as Error).message, wiped: false };
    }
    if (result.kind === "signed-out" && result.wipeError === null) {
      window.location.assign("/app/login");
      return;
    }
    setOutcome(result);
    setBusy(false);
  };

  if (outcome?.kind === "confirm") {
    return (
      <span className="row" role="alert" data-testid="sign-out-confirm">
        <span>{signOutQuestion(outcome)}</span>
        <button type="button" className="inline danger" disabled={busy} onClick={() => run(true)}>
          {busy ? "Signing out…" : "Sign out and discard"}
        </button>
        <button type="button" className="inline link" disabled={busy} onClick={() => setOutcome(null)}>
          Stay signed in
        </button>
        <a href="/app/outbox">See what is waiting</a>
      </span>
    );
  }
  if (outcome?.kind === "signed-out") {
    return (
      <span className="error" role="alert">
        You are signed out, but this phone could not clear what it was holding ({outcome.wipeError}). It can be seen again only by
        signing in as you on this phone. <a href="/app/login">Continue</a>
      </span>
    );
  }
  return (
    <>
      <button type="button" className="inline link" disabled={busy} onClick={() => run(false)}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {outcome?.kind === "failed" && (
        <span className="error" role="alert">
          {" "}
          Could not sign out ({outcome.message}). Try again.
          {outcome.wiped ? " What this phone was holding has already been removed." : ""}
        </span>
      )}
    </>
  );
}
