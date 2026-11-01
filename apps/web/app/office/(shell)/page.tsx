import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Office overview: counts read through RLS, each linked to the page that acts on it.
// The shell layout has already required TOTP and an active office profile.
export default async function OfficeHome() {
  const sb = await supabaseServer();
  const head = { count: "exact" as const, head: true };
  const n = (r: { count: number | null; error: unknown }) => (r.error ? null : (r.count ?? 0));
  const [pending, people, territories] = (
    await Promise.all([
      sb.from("device").select("id", head).eq("status", "pending"),
      sb.from("user_profile").select("id", head).eq("status", "active"),
      sb.from("territory").select("id", head).eq("active", true),
    ])
  ).map(n);
  const show = (n: number | null) => (n === null ? "—" : String(n));

  return (
    <>
      <h1>Overview</h1>
      <div className="tiles">
        <Link className="tile" href="/office/devices">
          <span className="big">{show(pending)}</span>
          <span>phones waiting for approval</span>
        </Link>
        <Link className="tile" href="/office/team">
          <span className="big">{show(people)}</span>
          <span>active people</span>
        </Link>
        <Link className="tile" href="/office/territories">
          <span className="big">{show(territories)}</span>
          <span>active territories</span>
        </Link>
      </div>
      <p className="muted">
        Salons, stock, orders, payments and reports arrive slice by slice (docs/audit-2026-10-31/execution-map.md).
      </p>
    </>
  );
}
