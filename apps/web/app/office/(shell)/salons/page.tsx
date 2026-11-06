"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { OfficeAddSalon } from "@/components/office-add-salon";
import { db, rows } from "@/lib/rpc";
import { label } from "@/lib/salons";

const STAGES = ["prospect", "visited", "trial", "active_new", "active_regular", "at_risk", "dormant", "parked", "blocked"];
const PAGE = 50;

type Row = {
  id: string;
  name: string | null;
  type: string;
  stage: string;
  approval_status: string;
  area: { name: string; territory: { name: string } | null } | null;
};

// Office salon list (execution map slice 3; SAL-01, SAL-05). Owner or manager at AAL2: the salon
// table's RLS shows rows only to office users (doc 06 §4). No phone numbers on the list, 50 rows a
// page, no export (H-14 spirit for bulk reads). Filters run in the database.
export default function OfficeSalons() {
  const [list, setList] = useState<Row[]>([]);
  const [stage, setStage] = useState("");
  const [approval, setApproval] = useState("");
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  // The term actually queried: set when the filter form is submitted, which also goes back to page 1.
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = db()
        .from("salon")
        .select("id, name, type, stage, approval_status, area:area_id(name, territory:territory_id(name))")
        .order("name", { nullsFirst: false })
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE);
      if (stage) q = q.eq("stage", stage);
      if (approval) q = q.eq("approval_status", approval);
      if (term) q = q.ilike("name", `%${term.replace(/[%_\\]/g, "\\$&")}%`);
      const r = await rows<Row>(q);
      setMore(r.length > PAGE);
      setList(r.slice(0, PAGE));
      const rejected = r
        .slice(0, PAGE)
        .filter((s) => s.approval_status === "rejected")
        .map((s) => s.id);
      const why =
        rejected.length === 0
          ? []
          : await rows<{ salon_id: string; reason: string | null }>(
              db().from("salon_approval_decision").select("salon_id, reason").eq("decision", "rejected").in("salon_id", rejected),
            );
      setReasons(new Map(why.map((w) => [w.salon_id, w.reason ?? ""])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, stage, term, approval]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>Salons</h1>
      <p>
        <Link href="/office/salons/approvals">Salon approvals</Link>
      </p>
      <OfficeAddSalon />
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setTerm(search.trim());
        }}
      >
        <label>
          Name contains
          <input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={120} />
        </label>
        <button type="submit" className="inline">
          Search
        </button>
        <label>
          Stage
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Approval
          <select
            value={approval}
            onChange={(e) => {
              setApproval(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </form>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No salons match." />
      {!loading && !error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Salon</th>
              <th>Territory · area</th>
              <th>Type</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td data-label="Salon">
                  <Link href={`/office/salons/${s.id}`}>{s.name ?? "Unnamed salon"}</Link>
                </td>
                <td data-label="Territory · area">
                  {s.area?.territory?.name ?? "—"} · {s.area?.name ?? "—"}
                </td>
                <td data-label="Type">{label(s.type)}</td>
                <td data-label="Stage">
                  <span className="badge">{label(s.stage)}</span>
                  {s.approval_status !== "approved" && (
                    <span className={`badge ${s.approval_status}`}> {label(s.approval_status)}</span>
                  )}
                  {s.approval_status === "rejected" && reasons.get(s.id) && (
                    <div className="muted" data-testid="rejection-reason">
                      Rejected: {reasons.get(s.id)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        {page > 0 && (
          <button type="button" className="inline" onClick={() => setPage((p) => p - 1)}>
            Previous 50
          </button>
        )}
        {more && (
          <button type="button" className="inline" onClick={() => setPage((p) => p + 1)}>
            Next 50
          </button>
        )}
      </div>
    </>
  );
}
