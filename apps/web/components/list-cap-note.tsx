import { capNote } from "@/lib/list-cap";

/** Says so when a list has reached the database's cap (see lib/list-cap.ts); shows nothing below it. */
export function ListCapNote({ shown, cap, what }: { shown: number; cap: number; what: string }) {
  const note = capNote(shown, cap, what);
  if (!note) return null;
  return (
    <p className="muted" data-testid="list-cap-note">
      {note}
    </p>
  );
}
