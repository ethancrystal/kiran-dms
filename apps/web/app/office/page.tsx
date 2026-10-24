import { redirect } from "next/navigation";
import { assurance, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The empty office app of the Gate 0 exit criterion: owner/manager reach it only with MFA.
export default async function Office() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/office/login");
  const { current } = await assurance();
  if (current !== "aal2") redirect("/office/mfa");

  const { data: profile } = await sb
    .from("user_profile")
    .select("full_name, role, status, vault_grant")
    .eq("id", user.id)
    .maybeSingle();

  const office = profile && (profile.role === "owner" || profile.role === "manager") && profile.status === "active";

  return (
    <main>
      <h1>Office</h1>
      <p className="muted">Signed in with two-step verification.</p>
      <div className="card">
        {office ? (
          <dl>
            <dt>Name</dt><dd>{profile.full_name}</dd>
            <dt>Role</dt><dd>{profile.role}</dd>
            <dt>Vault access</dt><dd>{profile.vault_grant ? "granted" : "not granted"}</dd>
          </dl>
        ) : (
          <p className="error">
            This login has no active owner or manager profile. Ask the owner to create one.
          </p>
        )}
      </div>
      <p className="muted">Dashboards, approvals and reconciliation arrive in Phase 1 (docs/11-roadmap.md).</p>
    </main>
  );
}
