"use client";
import { useCallback, useEffect, useState } from "react";
import { discardItem, listItems, retryItem, subscribe, sync, syncHistory, syncState } from "@/lib/outbox";
import type { AttemptResult, OutboxItem, SyncAttempt } from "@/lib/outbox/types";
import { when } from "@/lib/time";

const RESULT_TEXT: Record<AttemptResult, string> = {
  sent: "Sent",
  offline: "Not sent: no signal, or the server was busy",
  auth: "Not sent: sign in again, or this phone needs approval",
  rejected: "Refused",
};
const HELD_TEXT = {
  none: null,
  offline: "No signal right now. Waiting items are sent by themselves when the signal is back.",
  auth: "Nothing can be sent until you sign in again or your manager approves this phone.",
} as const;

const at = (ms: number) => when(new Date(ms).toISOString());

// What this phone is holding (P1-09, NFR-01): actions still waiting to be sent, actions the server
// refused and why, and the last 50 sends. Everything here is read from the phone, so the page opens
// with no signal. Retry sends the same request again; Discard removes it from the phone for good.
export default function OutboxPage() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [history, setHistory] = useState<SyncAttempt[]>([]);
  const [state, setState] = useState(syncState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, sends] = await Promise.all([listItems(), syncHistory()]);
      setItems(mine);
      setHistory(sends);
      setState(syncState());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribe(() => {
      void load();
    });
  }, [load]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
      await load();
    }
  };

  const waiting = items.filter((item) => item.state === "pending");
  const refused = items.filter((item) => item.state === "rejected");
  const held = HELD_TEXT[state.held];

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>Waiting to send</h1>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && (
        <>
          <p className="muted" data-testid="outbox-last-sync">
            {state.lastSyncAt
              ? `Last sent everything: ${at(state.lastSyncAt)}`
              : "Nothing has been sent since this page was opened."}
          </p>
          {held && <p className="error">{held}</p>}
          {state.error && <p className="error">{state.error}</p>}

          <section aria-label="Waiting to send">
            <h2 data-testid="outbox-waiting-count">Waiting ({waiting.length})</h2>
            {waiting.length === 0 && <p className="muted">Nothing is waiting on this phone.</p>}
            {waiting.map((item) => (
              <div className="card" key={item.id}>
                <p>
                  <strong>{item.label}</strong>
                </p>
                <p className="muted">
                  Saved on this phone {when(item.capturedAt)}
                  {item.attempts > 0 ? `. Tried ${item.attempts} time${item.attempts === 1 ? "" : "s"}.` : ""}
                </p>
              </div>
            ))}
            {waiting.length > 0 && (
              <button type="button" className="inline" disabled={busy} onClick={() => act(sync)}>
                {busy ? "Sending…" : "Send now"}
              </button>
            )}
          </section>

          <section aria-label="Needs attention">
            <h2 data-testid="outbox-refused-count">Needs attention ({refused.length})</h2>
            {refused.length === 0 && <p className="muted">Nothing was refused.</p>}
            {refused.map((item) => (
              <div className="card" key={item.id}>
                <p>
                  <strong>{item.label}</strong>
                </p>
                <p className="muted">Saved on this phone {when(item.capturedAt)}</p>
                <p className="error">The server refused it: {item.error ?? "no reason was given"}</p>
                {confirming === item.id ? (
                  <div className="row">
                    <span>Remove it from this phone for good? It will never be sent.</span>
                    <button
                      type="button"
                      className="inline danger"
                      disabled={busy}
                      onClick={() => act(() => discardItem(item.id))}
                    >
                      Yes, discard
                    </button>
                    <button type="button" className="inline link" disabled={busy} onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="row">
                    <button type="button" className="inline" disabled={busy} onClick={() => act(() => retryItem(item.id))}>
                      Retry
                    </button>
                    <button type="button" className="inline link danger" disabled={busy} onClick={() => setConfirming(item.id)}>
                      Discard
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section aria-label="Recent sends">
            <h2>Recent sends</h2>
            <p className="muted">The last 50 times this phone tried to send something, newest first.</p>
            {history.length === 0 && <p className="muted">This phone has not tried to send anything yet.</p>}
            <ul data-testid="outbox-history">
              {history.map((attempt) => (
                <li key={attempt.id}>
                  <span className={attempt.result === "sent" ? "ok" : "error"}>{RESULT_TEXT[attempt.result]}</span>
                  {": "}
                  {attempt.label}, {at(attempt.at)}
                  {attempt.message ? <span className="muted"> ({attempt.message})</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
