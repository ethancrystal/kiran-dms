"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

/** One row of app.office_salon_timeline or app.office_order_timeline (migration 20261105160000). */
export type TimelineEvent = {
  seq: number;
  occurred_at: string;
  actor_name: string | null;
  actor_kind: string;
  action: string;
  detail: string | null;
  entity: string;
  entity_id: string | null;
};

const FN = { salon: "office_salon_timeline", order: "office_order_timeline" } as const;
const ARG = { salon: "p_salon_id", order: "p_order_id" } as const;
const label = (s: string) => s.replaceAll("_", " ");

/**
 * Who did what and when, for one salon or one order (slice 7, P1-24; spec section 3). The office reads
 * it through a scoped function at AAL2; the raw audit log stays owner-only. The rows are the
 * database's allow-listed fields: no phone, pin, note, reason, amount or supplier data. `reloadKey`
 * re-reads it after the page changes something.
 */
export function Timeline({ kind, id, reloadKey = 0 }: { kind: "salon" | "order"; id: string; reloadKey?: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the page's signal to read the timeline again.
  useEffect(() => {
    let live = true;
    const read = async () => {
      setError(null);
      try {
        const r = await rpc<TimelineEvent[]>(FN[kind], { [ARG[kind]]: id });
        if (live) setEvents(r ?? []);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [kind, id, reloadKey]);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!events)
    return (
      <p className="muted" aria-busy="true">
        Loading the timeline…
      </p>
    );
  if (events.length === 0) return <p className="muted">Nothing recorded yet.</p>;
  return (
    <ol className="plain" data-testid={`${kind}-timeline`}>
      {events.map((e) => (
        <li key={e.seq}>
          <strong>{e.action}</strong>
          {e.detail && <span className="muted"> · {label(e.detail)}</span>} · {e.actor_name ?? "system"}{" "}
          <span className="badge">{e.actor_kind}</span> <span className="muted">{when(e.occurred_at)}</span>
        </li>
      ))}
    </ol>
  );
}
