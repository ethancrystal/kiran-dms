// Public configuration only. The service-role key must never be read in this app (H-18).

/**
 * A URL counts as configured only when it parses as an absolute http(s) URL.
 * Placeholder values copied from .env.example (https://<project-ref>.supabase.co)
 * carry angle brackets, which supabase-js throws on at client construction; rejecting
 * them here keeps the app on its "not configured" path instead of a 500. Brought in
 * from the AI Studio staging run of 2026-11-21
 * (docs/integration/2026-11-21-ai-studio-staging-readiness.md), with the key-length
 * rule dropped so the e2e placeholder key stays valid (playwright.config.ts).
 */
export const isConfiguredUrl = (url: string): boolean => {
  if (!url || url.includes("<") || url.includes(">")) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
};

/** A key counts as configured when it is non-empty and carries no placeholder brackets. */
export const isConfiguredKey = (key: string): boolean => Boolean(key && !key.includes("<") && !key.includes(">"));

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = isConfiguredUrl(rawUrl) && isConfiguredKey(rawKey);

// When unconfigured, the client factories still need well-formed arguments so a
// staging render never crashes: they point at the guaranteed-non-resolvable .invalid
// domain, so any request fails fast and visibly instead of reaching a real host.
export const SUPABASE_URL = supabaseConfigured ? rawUrl : "https://not-configured.invalid";
export const SUPABASE_ANON_KEY = supabaseConfigured ? rawKey : "not-configured-placeholder-key";
