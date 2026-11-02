"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="inline link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        window.location.assign("/office/login");
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
