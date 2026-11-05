"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RepSignOut } from "@/components/rep-sign-out";
import { mySession, rpc } from "@/lib/rpc";

type Gate =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "stop"; message: string; salon?: boolean }
  | { kind: "error"; message: string };

// Today (/app) registers the phone and explains its own state; the sign-in page needs no session.
const UNGATED = new Set(["/app", "/app/login"]);

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
        const s = await mySession();
        let next: Gate = { kind: "ok" };
        if (!s) {
          const salon = await rpc<unknown>("salon_me");
          next = salon
            ? { kind: "stop", salon: true, message: "This is a salon's login, not a rep's. Your account is in the salon portal." }
            : { kind: "stop", message: "Your account is not set up yet. Open Today to see your sign-in code for the owner." };
        } else if (s.role !== "rep") {
          next = { kind: "stop", message: "These pages are for reps. Owners and managers work in the office." };
        } else if (s.status !== "active") {
          next = { kind: "stop", message: "Your account is not active, so these pages show nothing. Contact your manager." };
        } else if (s.device_status !== "approved") {
          next = {
            kind: "stop",
            message:
              s.device_status === "pending"
                ? "This phone is waiting for your manager's approval. Until then these pages show nothing."
                : "This phone is not approved. Open Today to register it, then ask your manager to approve it.",
          };
        }
        if (live) setGate(next);
      } catch (e) {
        if (live) setGate({ kind: "error", message: (e as Error).message });
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, [open]);

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
