"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// REP-11 (P1-30): ends this phone's session and goes back to the sign-in page. The phone's device id
// stays, so the same approved phone signs in again without a new approval.
export function RepSignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="inline link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        window.location.assign("/app/login");
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
