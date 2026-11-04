"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Me = { name: string | null; address: string | null; approval_status: string; membership_status: string };
type State = { kind: "loading" } | { kind: "none" } | { kind: "ready"; me: Me } | { kind: "error"; message: string };

// The salon account (D-41, slice 1): the caller's own salon from app.salon_me, which resolves it from
// the active membership and returns allow-listed fields only. Nothing here takes a salon id. The
// catalogue, requests, orders and balance arrive with the salon portal (slice 6).
export default function SalonHome() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const read = async () => {
      try {
        const me = await rpc<Me | null>("salon_me");
        setState(me ? { kind: "ready", me } : { kind: "none" });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    };
    void read();
  }, []);

  return (
    <main>
      <h1>Your salon account</h1>
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
      {state.kind === "none" && (
        <p className="error" role="alert">
          This login has no active salon account. If the office sent you an invitation, open its link; otherwise ask the office.
        </p>
      )}
      {state.kind === "ready" && (
        <section className="card" aria-labelledby="salon-h">
          <h2 id="salon-h">{state.me.name ?? "Your salon"}</h2>
          {state.me.address && <p>{state.me.address}</p>}
          <p>
            Account: <span className="badge">{label(state.me.membership_status)}</span>
          </p>
          {state.me.approval_status !== "approved" && (
            <p className="muted" data-testid="pending-notice">
              Your salon is {label(state.me.approval_status)}: the office has not approved it yet, so it cannot order.
            </p>
          )}
          <p className="muted">Ordering from this page is not open yet. Your rep or the office takes your orders.</p>
        </section>
      )}
      <button
        type="button"
        className="inline link"
        onClick={async () => {
          await supabaseBrowser().auth.signOut();
          window.location.assign("/salon/login");
        }}
      >
        Sign out
      </button>
    </main>
  );
}
