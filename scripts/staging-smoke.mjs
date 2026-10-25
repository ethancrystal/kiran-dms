#!/usr/bin/env node
/**
 * staging-smoke — read-only check of the hosted Data API (ACTIVITY F-2, B-18).
 *
 * Proves the dashboard setting "Exposed schemas" is right on a hosted project, which
 * supabase/config.toml cannot set (it configures only the local CLI stack):
 *   - app.my_session and app.register_device are REACHABLE: an auth/permission refusal
 *     (401/403, 42501) is a pass; 406 "Invalid schema" (PGRST106) or 404 "function not
 *     found" (PGRST202) is a fail;
 *   - schemas control and supplier_vault are NOT exposed: they must answer 406 PGRST106;
 *   - an anonymous read of public.user_profile is refused.
 *
 * Uses the public anon/publishable key only, read from the environment and never printed:
 *   KIRAN_STAGING_URL=https://<ref>.supabase.co KIRAN_STAGING_ANON_KEY=<key> node scripts/staging-smoke.mjs
 *
 * Writes nothing. The register_device probe runs as anon, which has no EXECUTE grant on it
 * (and the function itself refuses any caller without a profile), so no row can be created.
 * Never point it at production without MJ's approval (H-19).
 */
const url = (process.env.KIRAN_STAGING_URL ?? "").replace(/\/+$/, "");
const key = process.env.KIRAN_STAGING_ANON_KEY ?? "";
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || key.length < 20) {
  console.error("Set KIRAN_STAGING_URL (https://<ref>.supabase.co) and KIRAN_STAGING_ANON_KEY (anon/publishable key).");
  process.exit(2);
}
if (/service_role|sb_secret_/i.test(key) || (() => { try { return JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "service_role"; } catch { return false; } })()) {
  console.error("Refusing to run with a service-role/secret key (H-18). Use the anon/publishable key.");
  process.exit(2);
}

const base = { apikey: key, Authorization: `Bearer ${key}` };
async function call(method, path, profileHeader, schema, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { ...base, [profileHeader]: schema, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let code = null;
  let message = "";
  try { const j = await res.json(); code = j?.code ?? null; message = j?.message ?? ""; } catch { /* empty body */ }
  return { status: res.status, code, message };
}

const reachable = (r) => r.status !== 406 && r.code !== "PGRST106" && r.code !== "PGRST202" && r.status !== 404;
const hidden = (r) => r.status === 406 && r.code === "PGRST106";
const denied = (r) => (r.status === 401 || r.status === 403) && (r.code === "42501" || r.code === "PGRST301" || /permission denied/i.test(r.message));

const checks = [
  ["app.my_session reachable (auth refusal is fine)", () => call("POST", "/rest/v1/rpc/my_session", "Content-Profile", "app", {}), reachable],
  ["app.register_device reachable (auth refusal is fine)", () => call("POST", "/rest/v1/rpc/register_device", "Content-Profile", "app",
    { p_fingerprint: "staging-smoke-probe-0000", p_platform: null, p_label: null }), reachable],
  ["control schema NOT exposed (406)", () => call("GET", "/rest/v1/approval_request?select=id&limit=1", "Accept-Profile", "control"), hidden],
  ["supplier_vault schema NOT exposed (406)", () => call("GET", "/rest/v1/supplier?select=id&limit=1", "Accept-Profile", "supplier_vault"), hidden],
  ["anon cannot read public.user_profile", () => call("GET", "/rest/v1/user_profile?select=id&limit=1", "Accept-Profile", "public"), denied],
];

let failed = 0;
console.log(`staging-smoke against ${url} (key not shown)`);
for (const [name, run, ok] of checks) {
  let r;
  try { r = await run(); } catch (e) { r = { status: "ERR", code: null, message: String(e.message ?? e) }; }
  const pass = r.status !== "ERR" && ok(r);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  [${r.status}${r.code ? " " + r.code : ""}${r.message ? ": " + r.message.slice(0, 90) : ""}]`);
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
