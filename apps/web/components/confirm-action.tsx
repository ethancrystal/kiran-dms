"use client";
import { useState } from "react";

// The shortest reason a required field accepts by default; a screen whose function asks for more
// passes reasonMinLength.
const DEFAULT_REASON_MIN_LENGTH = 3;

/**
 * A button that opens an inline confirmation with a reason field, then runs `onConfirm`.
 * The database decides; a refusal is shown here, never swallowed.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  reasonLabel = "Reason",
  reasonRequired = true,
  reasonMinLength = DEFAULT_REASON_MIN_LENGTH,
  danger = false,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** Shortest reason accepted when a reason is required; match the database function's own minimum. */
  reasonMinLength?: number;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={`inline${danger ? " danger" : ""}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="confirm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onConfirm(reason.trim());
          setOpen(false);
          setReason("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {reasonLabel}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required={reasonRequired}
          minLength={reasonRequired ? reasonMinLength : undefined}
          maxLength={300}
          aria-label={reasonLabel}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className={`inline${danger ? " danger" : ""}`} disabled={busy}>
          {busy ? "Saving…" : (confirmLabel ?? label)}
        </button>
        <button type="button" className="inline link" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Loading, error and empty states shared by every list. */
export function ListState({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (empty) return <p className="muted">{emptyText}</p>;
  return null;
}
