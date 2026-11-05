import Link from "next/link";
import { supabaseConfigured } from "@/lib/env";

export default function Home() {
  return (
    <main>
      <h1>Kiran DMS</h1>
      <p className="muted">Kiran Company · Karachi</p>
      {!supabaseConfigured && (
        <p className="error">Supabase is not configured. Copy apps/web/.env.example to .env.local.</p>
      )}
      <Link className="btn" href="/app">
        Field app
      </Link>
      <Link className="btn" href="/office">
        Office (owner / manager)
      </Link>
    </main>
  );
}
