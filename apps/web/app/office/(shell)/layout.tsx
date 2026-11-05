import Link from "next/link";
import { redirect } from "next/navigation";
import { assurance, supabaseServer } from "@/lib/supabase/server";
import { SignOut } from "./sign-out";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/office", label: "Overview" },
  { href: "/office/devices", label: "Devices" },
  { href: "/office/team", label: "Team" },
  { href: "/office/people", label: "People" },
  { href: "/office/territories", label: "Territories" },
  { href: "/office/salons", label: "Salons" },
  { href: "/office/salons/approvals", label: "Salon approvals" },
  { href: "/office/products", label: "Products" },
  { href: "/office/orders", label: "Orders" },
  { href: "/office/receivables", label: "Receivables" },
  { href: "/office/handovers", label: "Cash handover" },
  { href: "/office/investors", label: "Investors" },
];

// The office shell (execution map, slice 1). Signed in with TOTP (SEC-02) and an active owner or
// manager profile; otherwise no office page renders. This is convenience: every read and write
// below is decided again by RLS and the app.* functions (doc 06 §2).
export default async function OfficeShell({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/office/login");
  const { current } = await assurance();
  if (current !== "aal2") redirect("/office/mfa");

  const { data: profile, error: profileError } = await sb
    .from("user_profile")
    .select("full_name, role, status")
    .eq("id", user.id)
    .maybeSingle();
  // A failed read is not "no profile": say so, and show no office page.
  if (profileError) {
    // Server-side log only; the page shows a generic message so database details never reach the browser.
    console.error("office layout: profile read failed", profileError);
    return (
      <main>
        <h1>Office</h1>
        <p className="error" role="alert">
          Your profile could not be loaded. Reload the page; if it persists, sign in again.
        </p>
        <SignOut />
      </main>
    );
  }
  const office = profile && (profile.role === "owner" || profile.role === "manager") && profile.status === "active";

  if (!office) {
    return (
      <main>
        <h1>Office</h1>
        <div className="card">
          <p className="error" role="alert">
            This login has no active owner or manager profile. Ask the owner to add you.
          </p>
          <p className="muted">
            Your sign-in code: <code data-testid="signin-code">{user.id}</code>
          </p>
        </div>
        <SignOut />
      </main>
    );
  }

  return (
    <div className="office">
      <header className="topbar">
        <strong>Kiran DMS</strong>
        <nav aria-label="Office">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="muted who">
          {profile.full_name} · {profile.role}
        </span>
        <SignOut />
      </header>
      <main>{children}</main>
    </div>
  );
}
