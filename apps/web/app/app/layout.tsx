"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RepSignOut } from "@/components/rep-sign-out";
import { type Asked, decideGate, type Gate, readGateMemory, writeGateMemory } from "@/lib/outbox/gate";
import { rpc, type Session } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Today (/app) registers the phone and explains its own state; the sign-in page needs no session.
const UNGATED = new Set(["/app", "/app/login"]);
// The outbox page reads only what this phone holds and has to open with no signal (P1-09). With
// signal it is gated like every other page. It opens unchecked only when the request got no answer
// at all (a busy server is an answer), a session is held on this phone, and the server's last answer
// to this phone for that login was "allowed" (lib/outbox/gate.ts). What the browser says about being
// online is not asked: the request is always made.
const OPENS_WITHOUT_SIGNAL = new Set(["/app/outbox"]);

/** Asks app.my_session, and app.salon_me when there is no staff profile. A failure is handed on, not thrown. */
const ask = async (): Promise<Asked> => {
  const { data, error, status } = await supabaseBrowser().schema("app").rpc("my_session");
  if (error) return { kind: "failed", error: { ...error, status } };
  const session = (data as Session | null) ?? null;
  return { kind: "answered", session, salon: session ? false : Boolean(await rpc<unknown>("salon_me")) };
};

// REP-04 (P1-30). Every rep page except Today and sign-in asks app.my_session first (the one call that
// still answers on an unapproved phone or a suspended account) and, when the rep cannot work, says why
// instead of the empty lists the database's filters would show ("Your bag is empty" on a pending phone).
// Convenience only: every read and write is decided again by the database (app.self_ok, RLS).
export default function RepPages({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const open = UNGATED.has(path);
  const [gate, setGate] = useState<Gate>({ kind: "checking" });

  useEffect(() => {
    if (open) return;
    let live = true;
    const check = async () => {
      try {
        const [asked, held] = await Promise.all([ask(), supabaseBrowser().auth.getSession()]);
        const { gate: next, remember } = decideGate({
          opensWithoutSignal: OPENS_WITHOUT_SIGNAL.has(path),
          asked,
          userId: held.data.session?.user.id ?? null,
          memory: readGateMemory(window.localStorage),
        });
        if (remember) writeGateMemory(window.localStorage, remember);
        if (live) setGate(next);
      } catch (e) {
        if (live) setGate({ kind: "error", message: (e as Error).message });
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, [open, path]);

  if (open || gate.kind === "ok") return <>{children}</>;
  if (gate.kind === "checking")
    return (
      <main>
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      </main>
    );
  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <p className="error" role="alert" data-testid="rep-gate">
        {gate.message}
      </p>
      {gate.kind === "stop" && gate.salon && (
        <p>
          <a className="btn" href="/salon">
            Open the salon portal
          </a>
        </p>
      )}
      <p>
        <RepSignOut />
      </p>
    </main>
  );
}
