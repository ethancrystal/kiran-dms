import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** Supabase client for Server Components and Route Handlers, acting as the signed-in user. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

export type Aal = "aal1" | "aal2" | null;

/** Current and next assurance level, read from the session (doc 06 §3). */
export async function assurance() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return { current: (data?.currentLevel ?? null) as Aal, next: (data?.nextLevel ?? null) as Aal };
}
