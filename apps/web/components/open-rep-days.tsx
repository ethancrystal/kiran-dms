"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { day, karachiToday, when } from "@/lib/overview";
import { db, rows, rpc } from "@/lib/rpc";

type OpenDay = { id: string; day: string; check_in_at: string; rep: { full_name: string } | null };

const REASON_MIN = 3; // app.assert_reason
const LIST = 100;

// REP-01, FLOW-04 (P1-30; PIP-09). A rep's day from an earlier Karachi date that is still open stops the
// rep checking in, and the rep cannot close it from the phone. The office lists those days (rep_day under
// office RLS) and closes one with a reason through app.office_force_close_rep_day (owner or manager at
// AAL2; recorded as force closed, with who and why). Nothing else about the day changes.
export function OpenRepDays() {
  const router = useRouter();
  const [list, setList] = useState<OpenDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(
        await rows<OpenDay>(
          db()
            .from("rep_day")
            .select("id, day, check_in_at, rep:rep_id(full_name)")
            .eq("status", "open")
            .lt("day", karachiToday())
            .order("day")
            .limit(LIST),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="open-days-h">
      <h2 id="open-days-h">Rep days left open</h2>
      <p className="muted">
        A rep who did not check out, or who worked past midnight, cannot check in again until the earlier day is closed. Only the
        office can close it.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No rep day from an earlier date is open." />
      {list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Day</th>
              <th>Checked in</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} data-testid="open-rep-day">
                <td>{d.rep?.full_name ?? "—"}</td>
                <td>{day(d.day)}</td>
                <td>{when(d.check_in_at)}</td>
                <td>
                  <ConfirmAction
                    label="Close this day"
                    confirmLabel="Close the day now"
                    reasonLabel="Why close the rep's day"
                    reasonMinLength={REASON_MIN}
                    onConfirm={async (reason) => {
                      await rpc("office_force_close_rep_day", { p_rep_day_id: d.id, p_reason: reason });
                      setNotice(`${d.rep?.full_name ?? "The rep"}'s day of ${day(d.day)} is closed. They can check in now.`);
                      await load();
                      router.refresh();
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
