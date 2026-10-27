/**
 * Builder tests for scripts/service-role-scan.mjs (H-18; council audit 2026-10-27, finding 1).
 * Each case plants files in a throwaway directory (os tmpdir, deleted afterwards) and runs the
 * scan there. Key values are fake and assembled at run time.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/service-role-scan.mjs");
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const FAKE_SERVICE_JWT = [b64({ alg: "HS256", typ: "JWT" }), b64({ role: "service_role", iss: "fake-test" }), "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const FAKE_ANON_JWT = [b64({ alg: "HS256", typ: "JWT" }), b64({ role: "anon", iss: "fake-test" }), "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");
const FAKE_SB_SECRET = "sb_" + "secret_" + "Zq8vR2mT9xLw4KpQ7yN3";

function scan(files: Record<string, string>, args: string[] = [], env: Record<string, string> = {}): number | null {
  const dir = mkdtempSync(join(tmpdir(), "kiran-srs-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEY: "", ...env } }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const OK = { "apps/web/lib/env.ts": "export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;\n", "packages/import/src/a.ts": "export const a = 1;\n" };

describe("service-role scan (H-18)", () => {
  it("passes clean source", () => {
    expect(scan(OK)).toBe(0);
  });

  it("refuses a key name anywhere in apps or packages, including the lines the old grep skipped", () => {
    expect(scan({ ...OK, "apps/web/lib/admin.ts": 'import "server-only";\nexport const k = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only\n' })).toBe(1);
    expect(scan({ ...OK, "apps/web/proxy.ts": "const k = process.env.SUPABASE_SECRET_KEY;\n" })).toBe(1);
    expect(scan({ ...OK, "apps/web/next.config.ts": 'env: { k: process.env.SUPABASE_SERVICE_ROLE_KEY }\n' })).toBe(1);
    expect(scan({ ...OK, "packages/shared/src/db.ts": "createClient(url, serviceRoleKey);\n" })).toBe(1);
  });

  it("fails closed when a root is missing or nothing is scanned", () => {
    expect(scan({ "apps/web/lib/env.ts": "export const a = 1;\n" })).toBe(1); // packages/ missing
    expect(scan({}, ["empty"])).toBe(1);
  });

  it("bundle: library comments pass; key values fail", () => {
    const lib = "/** Never expose your `service_role` key in the browser. */ const isNewApiKey = (k)=>k.startsWith(\"sb_secret_\");\n";
    expect(scan({ ...OK, "web/.next/static/chunks/a.js": lib }, ["apps", "packages", "--bundle", "web/.next/static"])).toBe(0);
    expect(scan({ ...OK, "web/.next/static/chunks/a.js": `const k="${FAKE_ANON_JWT}";` }, ["apps", "packages", "--bundle", "web/.next/static"])).toBe(0);
    expect(scan({ ...OK, "web/.next/static/chunks/a.js": `const k="${FAKE_SERVICE_JWT}";` }, ["apps", "packages", "--bundle", "web/.next/static"])).toBe(1);
    expect(scan({ ...OK, "web/.next/static/chunks/a.js": `const k="${FAKE_SB_SECRET}";` }, ["apps", "packages", "--bundle", "web/.next/static"])).toBe(1);
    const value = "configured-secret-value-" + "x9y8z7w6v5";
    expect(scan({ ...OK, "web/.next/static/chunks/a.js": `const k="${value}";` }, ["apps", "packages", "--bundle", "web/.next/static"], { SUPABASE_SERVICE_ROLE_KEY: value })).toBe(1);
  });
});
