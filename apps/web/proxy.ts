import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie and gates the office surface:
 *   /office/*  requires a signed-in user AND an AAL2 (TOTP-verified) session (SEC-02).
 *   /app/*     requires a signed-in user (rep, phone OTP). Device approval is enforced
 *              by the database on every call (app.rep_device_ok), not here.
 * This is convenience only. The control is RLS and the app.* functions (doc 06 §2).
 */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  if (!supabaseConfigured) return res;

  const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  const redirect = (to: string) => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (path.startsWith("/office") && path !== "/office/login") {
    if (!user) return redirect("/office/login");
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2" && path !== "/office/mfa") return redirect("/office/mfa");
  }
  if (path.startsWith("/app") && path !== "/app/login" && !user) return redirect("/app/login");
  return res;
}

export const config = {
  matcher: ["/office/:path*", "/app/:path*"],
};
