"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

/** One row of app.office_order_steps (migration 20261111020000). No price, phone or reason. */
export type OfficeStep = {
  step_key: string;
  meaning: string;
  performer: string;
  needs_approval: boolean;
  state: "done" | "current" | "upcoming";
  occurred_at: string | null;
  actor_name: string | null;
  actor_kind: string | null;
};

/** One row of app.salon_order_steps. The salon does not see who acted. */
export type SalonStep = {
  step_key: string;
  meaning: string;
  state: "done" | "current" | "upcoming";
  occurred_at: string | null;
};

const STATE_LABEL: Record<OfficeStep["state"], string> = {
  done: "done",
  current: "waiting",
  upcoming: "not yet",
};

function StepList({ steps, testId, showActor }: { steps: Array<OfficeStep | SalonStep>; testId: string; showActor: boolean }) {
  if (steps.length === 0) return <p className="muted">No steps for this order.</p>;
  return (
    <ol className="plain" data-testid={testId}>
      {steps.map((step) => {
        const office = "performer" in step ? step : null;
        return (
          <li key={step.step_key} data-testid={`step-${step.step_key}`} data-state={step.state}>
            <strong>{step.meaning}</strong> <span className="badge">{STATE_LABEL[step.state]}</span>
            {office && <span className="muted"> · {office.performer}</span>}
            {office?.needs_approval && <span className="badge">needs a decision</span>}
            {step.state === "done" && step.occurred_at && <span className="muted"> {when(step.occurred_at)}</span>}
            {showActor && office?.actor_name && <span> · {office.actor_name}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function useSteps<T>(fn: string, orderId: string, reloadKey: number) {
  const [steps, setSteps] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the page's signal to read the steps again.
  useEffect(() => {
    let live = true;
    const read = async () => {
      setError(null);
      try {
        const r = await rpc<T[]>(fn, { p_order_id: orderId });
        if (live) setSteps(r ?? []);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [fn, orderId, reloadKey]);
  return { steps, error };
}

function Gate({ error, loading }: { error: string | null; loading: boolean }) {
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (loading)
    return (
      <p className="muted" aria-busy="true">
        Loading the steps…
      </p>
    );
  return null;
}

/** The office reads every step of one order, including who did a finished step. */
export function OrderSteps({ orderId, reloadKey = 0 }: { orderId: string; reloadKey?: number }) {
  const { steps, error } = useSteps<OfficeStep>("office_order_steps", orderId, reloadKey);
  const gate = Gate({ error, loading: steps === null && !error });
  if (gate || !steps) return gate;
  return <StepList steps={steps} testId="order-steps" showActor />;
}

/** One salon's own order. Loaded only when that row asks for it. */
export function SalonSteps({ orderId }: { orderId: string }) {
  const { steps, error } = useSteps<SalonStep>("salon_order_steps", orderId, 0);
  const gate = Gate({ error, loading: steps === null && !error });
  if (gate || !steps) return gate;
  return <StepList steps={steps} testId={`salon-order-steps-${orderId}`} showActor={false} />;
}
