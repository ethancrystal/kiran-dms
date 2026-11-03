"use client";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";

type Group = "salon" | "territory" | "rep";
type Row = {
  group_id: string | null;
  group_name: string | null;
  salons: number;
  current_paisa: number;
  d1_7_paisa: number;
  d8_15_paisa: number;
  d16_30_paisa: number;
  d31_plus_paisa: number;
  overdue_paisa: number;
  total_paisa: number;
};

const GROUPS: Array<[Group, string]> = [
  ["salon", "Salon"],
  ["territory", "Territory"],
  ["rep", "Rep"],
];
const BUCKETS: Array<[keyof Row, string]> = [
  ["current_paisa", "Not yet due"],
  ["d1_7_paisa", "1–7 days"],
  ["d8_15_paisa", "8–15 days"],
  ["d16_30_paisa", "16–30 days"],
  ["d31_plus_paisa", "Over 30 days"],
  ["overdue_paisa", "Overdue"],
  ["total_paisa", "Total owed"],
];
// A row with no name: a salon never named, or (grouped by rep) salons whose territory has no rep.
const NO_NAME: Record<Group, string> = { salon: "Unnamed salon", territory: "—", rep: "No rep assigned" };
const nameOf = (r: Row, group: Group) => r.group_name ?? NO_NAME[group];

// Receivables ageing (PAY-07, doc 09 §9). Owner or manager at AAL2: app.office_receivables_ageing
// checks the caller and does all the arithmetic on today's Karachi date; this page only shows it.
// Grouped by rep, a salon counts under every rep currently covering its territory (ACTIVITY A-14),
// so the rep rows can add up to more than the total.
export default function Receivables() {
  const [group, setGroup] = useState<Group>("salon");
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList((await rpc<Row[]>("office_receivables_ageing", { p_group: group })) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [group]);
  useEffect(() => {
    void load();
  }, [load]);

  const totals = BUCKETS.map(([k]) => list.reduce((a, r) => a + Number(r[k]), 0));

  return (
    <>
      <h1>Receivables</h1>
      <p className="muted">
        What salons still owe, by days past each installment's due date (Karachi date). Paid installments are not shown.
      </p>
      <fieldset className="inline-form">
        <legend>Group by</legend>
        {GROUPS.map(([g, text]) => (
          <label key={g}>
            <input type="radio" name="group" value={g} checked={group === g} onChange={() => setGroup(g)} />
            {text}
          </label>
        ))}
      </fieldset>
      {group === "rep" && (
        <p className="muted">
          A salon is counted under every rep who covers its territory, so rep rows can add up to more than the total.
        </p>
      )}
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="Nothing is owed." />
      {!loading && !error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{GROUPS.find(([g]) => g === group)?.[1]}</th>
              {group !== "salon" && <th>Salons</th>}
              {BUCKETS.map(([k, text]) => (
                <th key={k}>{text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.group_id ?? "none"}>
                <td data-label={GROUPS.find(([g]) => g === group)?.[1]}>
                  {group === "salon" && r.group_id ? (
                    <a href={`/office/salons/${r.group_id}`}>{nameOf(r, group)}</a>
                  ) : (
                    nameOf(r, group)
                  )}
                </td>
                {group !== "salon" && <td data-label="Salons">{r.salons}</td>}
                {BUCKETS.map(([k, text]) => (
                  <td key={k} data-label={text}>
                    {rupees(Number(r[k]))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {group !== "rep" && (
            <tfoot>
              <tr>
                <th scope="row">All</th>
                {group !== "salon" && <td data-label="Salons">{list.reduce((a, r) => a + Number(r.salons), 0)}</td>}
                {BUCKETS.map(([k, text], n) => (
                  <td key={k} data-label={text}>
                    {rupees(totals[n])}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </>
  );
}
