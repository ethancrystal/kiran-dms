import Link from "next/link";
import { supabaseConfigured } from "@/lib/env";

export default function Home() {
  return (
    <main>
      <h1>Kiran DMS</h1>
      <p className="muted">Kiran Company · Karachi</p>

      <div className="card">
        {supabaseConfigured ? (
          <p className="ok">Connected to the Supabase backend.</p>
        ) : (
          <p className="muted">
            Supabase is not configured yet. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to connect to your database.
          </p>
        )}
      </div>

      <Link className="btn" href="/app">
        Field app
      </Link>
      <Link className="btn" href="/salon/login">
        Salon portal
      </Link>
      <Link className="btn" href="/office">
        Office (owner / manager)
      </Link>
    </main>
  );
}
