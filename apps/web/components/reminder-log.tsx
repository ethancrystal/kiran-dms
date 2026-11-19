"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { ListCapNote } from "@/components/list-cap-note";
import { REMINDER_KIND_PATH, reminderKindText, reminderResultText } from "@/lib/office-gaps";
import { db, rows, rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

type Round = {
  item_kind: string;
  item_id: string;
  recipient_id: string;
  round_no: number;
  sent_at: string;
  result: string;
};
type Person = { id: string; full_name: string };

// app.office_reminder_log returns the newest 200 rounds (migration 20261111020000).
const LOG_CAP = 200;

// P1-38 (D-60, MSG-03): the reminder rounds recorded for items waiting on a manager or the owner, from
// app.office_reminder_log (owner or manager at AAL2; the table itself has no grant). The rows carry a
// kind, an item id, a person and a result; no amount and no phone. Real mail is not sent until MJ
// names a service (B-61), so today every round reads "Not sent" or "Prepared".
export function ReminderLog() {
  const [list, setList] = useState<Round[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const go = async () => {
      try {
        const found = (await rpc<Round[] | null>("office_reminder_log")) ?? [];
        const ids = [...new Set(found.map((r) => r.recipient_id))];
        const people =
          ids.length === 0 ? [] : await rows<Person>(db().from("user_profile").select("id, full_name").in("id", ids));
        if (!live) return;
        setList(found);
        setNames(new Map(people.map((p) => [p.id, p.full_name])));
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    };
    void go();
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="card" aria-labelledby="reminder-log-h" data-testid="reminder-log">
      <h2 id="reminder-log-h">Reminder history</h2>
      <p className="muted">Each reminder round for an item that waited on a manager or the owner, newest first.</p>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No reminders recorded yet." />
      {!loading && !error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>What waited</th>
              <th>Round</th>
              <th>To</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.item_kind}-${r.item_id}-${r.recipient_id}-${r.round_no}`} data-testid="reminder-round">
                <td data-label="When">{when(r.sent_at)}</td>
                <td data-label="What waited">
                  {REMINDER_KIND_PATH[r.item_kind] ? (
                    <Link href={REMINDER_KIND_PATH[r.item_kind]}>{reminderKindText(r.item_kind)}</Link>
                  ) : (
                    reminderKindText(r.item_kind)
                  )}
                </td>
                <td data-label="Round">{r.round_no + 1}</td>
                <td data-label="To">{names.get(r.recipient_id) ?? "—"}</td>
                <td data-label="Result">{reminderResultText(r.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ListCapNote shown={list.length} cap={LOG_CAP} what="reminder rounds" />
    </section>
  );
}
