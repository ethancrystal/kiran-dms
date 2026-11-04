/**
 * Fourth re-verification (ACTIVITY §7, L-0055) of the rep app client fix in L-0045
 * (apps/web/lib/supabase/browser.ts and its use in apps/web/app/app/page.tsx).
 * Written by the re-verifier-4 subagent, not the builder.
 *
 * The probes run the REAL browser.ts and the REAL page.tsx (both transpiled with the repo's
 * TypeScript) against the installed @supabase/ssr, in a separate node process with a minimal
 * browser stub (localStorage, a cookie jar, location) and a fetch stub that records every
 * request and answers like the database would. Nothing leaves the machine.
 *
 * Tests named "DEFECT CHECK" state the SECURE / working expectation: a failure there is a
 * defect, not a broken test. Do not loosen them. Tests named "OBSERVATION" record behaviour
 * for MJ and pass either way.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayWorktree, writeLogEntries } from "./log-check-harness";

const ROOT = resolve(import.meta.dirname, "../..");
const WEB = join(ROOT, "apps", "web");
const SSR = join(WEB, "node_modules", "@supabase", "ssr", "dist", "main", "index.js");
const OLD = "web-old-revoked-rv4";

type Req = { seq: number; phase: string; path: string; device: string | null; fp: string | null; marker?: string };
type Probe = { sent: Req[]; states: Array<{ kind: string; session?: { device_status: string | null } }>; finalId: string | null; registered: string[]; extra: Record<string, unknown> };

/**
 * Runs `scenario` (JS source, top-level await allowed) after this preamble:
 *   B         the real browser.ts module (first instance)
 *   loadPage  (browserUrl?) => imports the real page.tsx bound to a browser.ts instance
 *   runPage   (Page, runs) => calls the component and runs its effect `runs` times (2 = React
 *             strict mode in development: mount, unmount, mount), then waits for every run
 *   setPhase  (name) => labels the following requests
 *   out       object whose fields are printed as `extra`
 * Before the scenario: localStorage holds the revoked id OLD, and the login page's client
 * (B.supabaseBrowser()) has signed in (setSession), as after app/app/login/page.tsx.
 */
function probe(scenario: string, opts: { visible?: boolean; fastTimers?: boolean; accessTtl?: number } = {}): Probe {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv4-"));
  try {
    const url = (p: string) => JSON.stringify(new URL(`file:///${p.replace(/\\/g, "/").replace(/^\/+/, "")}`).href);
    writeFileSync(join(dir, "env.mjs"), "export const SUPABASE_URL = 'http://127.0.0.1:1';\nexport const SUPABASE_ANON_KEY = 'placeholder-anon';\n");
    writeFileSync(join(dir, "react.mjs"), `
      export function useEffect(fn) { globalThis.__effects.push(fn); }
      export function useState(init) { return [init, (v) => { globalThis.__states.push(v); }]; }
    `);
    writeFileSync(join(dir, "jsx.mjs"), "export const jsx = () => null; export const jsxs = () => null; export const Fragment = null;\n");
    writeFileSync(join(dir, "probe.mjs"), `
      import { createRequire } from "node:module";
      import { readFileSync, writeFileSync } from "node:fs";
      const ts = createRequire(${JSON.stringify(join(ROOT, "package.json"))})("typescript");
      ${opts.fastTimers ? "const _si = setInterval; globalThis.setInterval = (f, ms, ...a) => _si(f, Math.min(ms, 150), ...a);" : ""}
      let seq = 0;
      const sent = [];
      let phase = "setup";
      globalThis.setPhase = (p) => { phase = p; };
      const store = new Map([["kiran.device", ${JSON.stringify(OLD)}]]);
      const jar = new Map();
      const doc = {
        visibilityState: ${opts.visible ? '"visible"' : "undefined"},
        addEventListener() {}, removeEventListener() {},
        get cookie() { return [...jar].map(([k, v]) => k + "=" + v).join("; "); },
        set cookie(s) {
          const [kv, ...attrs] = String(s).split(";");
          const i = kv.indexOf("=");
          const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
          if (!v || attrs.some((a) => /max-age=0\\b/i.test(a.trim()))) jar.delete(k); else jar.set(k, v);
        },
      };
      globalThis.window = {
        document: doc,
        location: { href: "http://localhost/app", origin: "http://localhost", protocol: "http:", host: "localhost", hostname: "localhost", pathname: "/app", search: "", hash: "" },
        localStorage: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => { sent.push({ seq: ++seq, phase, path: "", device: null, fp: null, marker: "localStorage.removeItem:" + k }); store.delete(k); },
        },
        ${opts.visible ? "addEventListener() {}, removeEventListener() {}," : ""}
      };
      globalThis.document = doc;
      globalThis.__effects = [];
      globalThis.__states = [];
      const warns = [];
      const _warn = console.warn; console.warn = (...a) => { warns.push(String(a[0]).slice(0, 160)); };
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const USER = { id: "00000000-0000-4000-8000-0000000000a1", aud: "authenticated", role: "authenticated", phone: "920000000001", app_metadata: {}, user_metadata: {}, created_at: "2026-10-25T00:00:00Z" };
      const ttl = ${opts.accessTtl ?? 3600};
      const jwt = () => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: USER.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + ttl, session_id: "s-rv4" }) + "." + "c2ln";
      const registered = [];
      globalThis.fetch = async (input, init = {}) => {
        const u = new URL(String(input instanceof Request ? input.url : input));
        const h = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
        const device = h.get("x-kiran-device");
        let body = null;
        try { body = init.body ? JSON.parse(init.body) : null; } catch {}
        sent.push({ seq: ++seq, phase, path: u.pathname + (u.searchParams.get("grant_type") ? "?grant_type=" + u.searchParams.get("grant_type") : ""), device, fp: body?.p_fingerprint ?? null });
        const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
        if (u.pathname === "/auth/v1/user") return json(USER);
        if (u.pathname === "/auth/v1/token") return json({ access_token: jwt(), refresh_token: "rt-" + seq, token_type: "bearer", expires_in: ttl, expires_at: Math.floor(Date.now() / 1000) + ttl, user: USER });
        if (u.pathname === "/auth/v1/otp") return json({});
        if (u.pathname.endsWith("/rpc/my_session")) {
          const st = device === ${JSON.stringify(OLD)} ? "revoked" : registered.includes(device) ? "pending" : null;
          return json({ full_name: "[Dummy] Rep", role: "rep", status: "active", device_status: st });
        }
        if (u.pathname.endsWith("/rpc/register_device")) {
          if (device === ${JSON.stringify(OLD)} || body?.p_fingerprint === ${JSON.stringify(OLD)}) return json({ code: "42501", message: "device id revoked" }, 403);
          registered.push(body?.p_fingerprint);
          return json({ id: "d-" + registered.length, status: "pending" });
        }
        return json({});
      };
      const transpile = (file, replacements, out, jsx) => {
        let src = readFileSync(file, "utf8");
        for (const [a, b] of replacements) src = src.replace(a, b);
        let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
        js = js.replace('"react/jsx-runtime"', ${JSON.stringify(url(join(dir, "jsx.mjs")))});
        writeFileSync(out, js);
      };
      transpile(${JSON.stringify(join(WEB, "lib", "supabase", "browser.ts"))},
        [['"@/lib/env"', ${JSON.stringify(url(join(dir, "env.mjs")))}], ['"@supabase/ssr"', ${JSON.stringify(url(SSR))}]],
        ${JSON.stringify(join(dir, "browser.mjs"))});
      const browserUrl = ${url(join(dir, "browser.mjs"))};
      let pageN = 0;
      globalThis.loadPage = async (bUrl = browserUrl) => {
        const out = ${JSON.stringify(join(dir, "page"))} + (++pageN) + ".mjs";
        transpile(${JSON.stringify(join(WEB, "app", "app", "page.tsx"))},
          [['"@/lib/supabase/browser"', JSON.stringify(bUrl)], ['"react"', ${JSON.stringify(url(join(dir, "react.mjs")))}]], out, true);
        return (await import(new URL("file:///" + out.replace(/\\\\/g, "/").replace(/^\\/+/, "")).href)).default;
      };
      globalThis.runPage = async (Page, runs) => {
        globalThis.__effects = [];
        const before = globalThis.__states.length;
        Page();
        for (const fn of globalThis.__effects) for (let i = 0; i < runs; i++) fn();
        const t0 = Date.now();
        while (globalThis.__states.length - before < runs && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 10));
        await new Promise((r) => setTimeout(r, 50));
      };
      const out = {};
      const B = await import(browserUrl);
      const login = B.supabaseBrowser();
      await login.auth.setSession({ access_token: jwt(), refresh_token: "rt-0" });
      setPhase("page");
      ${scenario}
      console.warn = _warn;
      out.warnings = warns;
      console.log("RV4JSON" + JSON.stringify({ sent, states: globalThis.__states, finalId: store.get("kiran.device") ?? null, registered, extra: out }));
      process.exit(0);
    `);
    const p = spawnSync(process.execPath, [join(dir, "probe.mjs")], { encoding: "utf8", timeout: 60_000 });
    if (p.status !== 0) throw new Error(`probe exited ${p.status}: ${p.stderr}\n${p.stdout}`);
    const line = p.stdout.split("\n").find((l) => l.startsWith("RV4JSON"));
    if (!line) throw new Error(`no probe output: ${p.stdout}\n${p.stderr}`);
    return JSON.parse(line.slice("RV4JSON".length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const firstRotation = (sent: Req[]) => sent.find((r) => r.marker === "localStorage.removeItem:kiran.device")?.seq ?? Infinity;
const requests = (sent: Req[]) => sent.filter((r) => !r.marker);
const brief = (rs: Req[]) => rs.map((r) => r.marker ?? `${r.path} dev=${r.device === OLD ? "OLD" : r.device ? "new:" + r.device.slice(4, 12) : "none"}${r.fp ? " fp=" + r.fp.slice(4, 12) : ""}`);

describe("rep app client after L-0045 (re-verifier-4)", () => {
  it("needs the installed apps/web dependencies", () => {
    expect(existsSync(SSR)).toBe(true);
  });

  it("single effect run (production): after the rotation every request, RPC and auth, carries the new id; one registration", () => {
    const got = probe(`
      const Page = await loadPage();
      await runPage(Page, 1);
      setPhase("after");
      const c = B.supabaseBrowser();
      out.newClientIsNotLogin = c !== login;
      await c.auth.getUser();                                        // auth call on the rebuilt client
      await c.schema("app").rpc("my_session");
      await B.supabaseBrowser().auth.signInWithOtp({ phone: "+920000000001", options: { shouldCreateUser: false } }); // login page path
    `);
    console.log("rv4 single run:", JSON.stringify(brief(got.sent)));
    const rot = firstRotation(got.sent);
    expect(rot).toBeLessThan(Infinity);
    const after = requests(got.sent).filter((r) => r.seq > rot);
    expect(after.length).toBeGreaterThanOrEqual(5);
    expect(after.every((r) => r.device === got.finalId && r.device !== OLD), JSON.stringify(brief(after))).toBe(true);
    expect(after.some((r) => r.path.startsWith("/auth/v1/"))).toBe(true);
    expect(got.registered).toEqual([got.finalId]);
    const reg = after.find((r) => r.path.endsWith("/rpc/register_device"))!;
    expect(reg.fp).toBe(reg.device);                                  // p_fingerprint and header agree
    expect(got.states.map((s) => s.kind)).toEqual(["ready"]);
    expect(got.states[0].session?.device_status).toBe("pending");
    expect(got.extra.newClientIsNotLogin).toBe(true);
  });

  it("page reload after the rotation: a fresh module instance reads the new id; the revoked id is never sent again", () => {
    const got = probe(`
      const Page = await loadPage();
      await runPage(Page, 1);
      setPhase("reload");
      // A reload is a new JS realm: new browser.ts and page.tsx module instances, same localStorage and cookies.
      const Page2 = await loadPage(browserUrl + "?reload=1");
      await runPage(Page2, 1);
    `);
    console.log("rv4 reload:", JSON.stringify(brief(got.sent.filter((r) => r.phase === "reload"))));
    const reload = requests(got.sent).filter((r) => r.phase === "reload");
    expect(reload.length).toBeGreaterThanOrEqual(2);
    expect(reload.every((r) => r.device === got.finalId)).toBe(true);
    expect(reload.some((r) => r.path.endsWith("/rpc/register_device"))).toBe(false); // already pending: no second registration
    expect(got.states.map((s) => s.session?.device_status)).toEqual(["pending", "pending"]);
  });

  it("DEFECT CHECK: React strict mode (next.config reactStrictMode: true) runs the effect twice; no request after the rotation may carry the revoked id, and the page must register one phone, the one it keeps", () => {
    const cfg = readFileSync(join(WEB, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/reactStrictMode:\s*true/);
    const got = probe(`
      const Page = await loadPage();
      await runPage(Page, 2);
    `);
    const seq = brief(got.sent);
    console.log("rv4 strict mode:", JSON.stringify(seq), "registered:", JSON.stringify(got.registered), "kept:", got.finalId);
    const rot = firstRotation(got.sent);
    const staleAfterRotation = requests(got.sent).filter((r) => r.seq > rot && r.device === OLD).map((r) => r.path);
    expect({ staleAfterRotation, registered: got.registered }).toEqual({ staleAfterRotation: [], registered: [got.finalId] });
  });

  it("DEFECT CHECK (production variant): two tabs of the rep app open after a revoke must not register two phones", () => {
    // Two tabs = two JS realms (two browser.ts and page.tsx module instances) sharing localStorage and cookies.
    const got = probe(`
      const Tab1 = await loadPage();
      const Tab2 = await loadPage(browserUrl + "?tab=2");
      globalThis.__effects = [];
      Tab1(); Tab2();
      for (const fn of globalThis.__effects) fn();
      const t0 = Date.now();
      while (globalThis.__states.length < 2 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 10));
    `);
    console.log("rv4 two tabs:", JSON.stringify(brief(got.sent)), "registered:", JSON.stringify(got.registered), "kept:", got.finalId);
    expect(got.registered).toEqual([got.finalId]);
  });

  it("OBSERVATION: the replaced client is not disposed; does it keep running and re-send the revoked id?", () => {
    // Visible tab, short access token: auth-js auto-refresh runs (its 30 s tick is shortened to 150 ms).
    const got = probe(`
      const Page = await loadPage();
      await runPage(Page, 1);
      setPhase("idle");
      await new Promise((r) => setTimeout(r, 1200));
      out.loginTicker = login.auth.autoRefreshTicker !== null && login.auth.autoRefreshTicker !== undefined;
    `, { visible: true, fastTimers: true, accessTtl: 60 });
    const idle = requests(got.sent).filter((r) => r.phase === "idle");
    const oldRefreshes = idle.filter((r) => r.device === OLD).map((r) => r.path);
    const newRefreshes = idle.filter((r) => r.device === got.finalId).map((r) => r.path);
    const multi = (got.extra.warnings as string[]).filter((w) => /Multiple GoTrueClient/.test(w)).length;
    console.log("rv4 stale client:", JSON.stringify({ loginTicker: got.extra.loginTicker, oldRefreshes: oldRefreshes.length, sampleOld: oldRefreshes.slice(0, 2), newRefreshes: newRefreshes.length, multipleGoTrueWarnings: multi }));
    expect(Array.isArray(oldRefreshes)).toBe(true);
  });

  it("only browser.ts creates a browser client; the server clients (server.ts, proxy.ts) send no device header", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) files.push(p);
      }
    };
    walk(WEB);
    const users = files.filter((f) => /@supabase\/(ssr|supabase-js)/.test(readFileSync(f, "utf8"))).map((f) => relative(WEB, f).replace(/\\/g, "/")).sort();
    expect(users).toEqual(["lib/supabase/browser.ts", "lib/supabase/server.ts", "proxy.ts"]);
    const creators = files.filter((f) => /createBrowserClient\s*\(/.test(readFileSync(f, "utf8"))).map((f) => relative(WEB, f).replace(/\\/g, "/"));
    expect(creators).toEqual(["lib/supabase/browser.ts"]);
    for (const f of ["lib/supabase/server.ts", "proxy.ts"]) expect(readFileSync(join(WEB, f), "utf8")).not.toMatch(/x-kiran-device/);
    // No page keeps a module-level client that would survive a rotation.
    const moduleLevel = files.filter((f) => /^(const|let|var)\s+\w+\s*=\s*supabaseBrowser\(/m.test(readFileSync(f, "utf8")));
    expect(moduleLevel).toEqual([]);
  });
});

/**
 * Log check (scripts/activity-log-check.mjs, L-0046) against ACTIVITY.md Appendix C. Each case
 * is one commit in a throwaway clone of this repo (os tmpdir, deleted afterwards), checked with
 * `node scripts/activity-log-check.mjs <base> HEAD`, with KIRAN_SENSITIVE_TERMS empty.
 * "DEFECT CHECK" = an evasion that should exit 1; "FALSE POSITIVE CHECK" = legitimate work that
 * should exit 0. Both state the expected behaviour; do not loosen them.
 */
describe("activity-log-check after L-0046 (re-verifier-4)", { timeout: 120_000 }, () => {
  const OTHER = "Tester · Model X · rv4-case-agent · branch t";
  const entry = (type: string, task: string) => [
    `# 2026-10-25 23:35 PKT · ${OTHER} · ${type}`,
    `**Task:** ${task}`,
    "**What / why:** rv4 case.",
    "**Evidence:** rv4 case evidence.",
    "**Rules touched:** —",
    "**Next / needs:** —",
    ...["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"],
    "",
  ];
  // Fake, unsigned, assembled at run time so this file itself does not trip the secret patterns.
  const JWT = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "ZmFrZS1zaWduYXR1cmUtcnY0"].join(".");
  const SB_SECRET = ["sb", "secret", "FAKEFAKEFAKE1234567"].join("_");

  function check(lines: string[], files: Record<string, string | Buffer> = {}): { status: number | null; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "kiran-rv4-log-"));
    try {
      const g = (...a: string[]) => {
        const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv4", "-c", "user.email=rv4@example.test", ...a], { cwd: dir, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
        return r.stdout;
      };
      const c = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
      if (c.status !== 0) throw new Error(c.stderr);
      // Test the WORKTREE script and log (not just the last commit), so a fix is seen before it is committed.
      overlayWorktree(ROOT, dir);
      g("add", "-A");
      g("commit", "-q", "--allow-empty", "-m", "rv4 base: worktree script and log");
      const base = g("rev-parse", "HEAD").trim();
      writeLogEntries(dir, lines);
      for (const [rel, content] of Object.entries(files)) {
        const p = join(dir, rel);
        mkdirSync(join(p, ".."), { recursive: true });
        writeFileSync(p, content);
      }
      g("add", "-A");
      g("commit", "-q", "-m", "rv4 case");
      const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: "" };
      delete env.DATABASE_URL;
      const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
      return { status: r.status, out: (r.stdout + r.stderr).trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const P = entry("TASK", "P0-04");

  it("control: a legitimate code change with a valid entry passes; a code change without one fails", () => {
    expect(check(P, { "apps/web/lib/rv4.ts": "export const a = 1;\n" }).status).toBe(0);
    expect(check([], { "apps/web/lib/rv4.ts": "export const a = 1;\n" }).status).toBe(1);
  });

  it("DEFECT CHECK (rule 2): a code fence opened inside a list item hides a forged, rendered VERIFIED header and raw HTML", () => {
    // CommonMark closes the fence when the list item ends, so the next lines render as an <h3> and an HTML
    // block; the script's fence scanner treats them as code and skips every structural rule.
    const r = check([...P, "- note", "  ```", "### L-0999 · 2026-10-25 23:40 PKT · MJ · human · owner sign-off · VERIFIED",
      "**Task:** P0-04, P0-05", "**Evidence:** VERIFIED by MJ, CI green.", "<details><summary>Archive</summary>hidden</details>", "", "- end", "  ```", ""]);
    console.log("rv4 log E-A:", r.status, r.out.slice(0, 200));
    expect(r.status).toBe(1);
  });

  it("DEFECT CHECK (rule 4): a VERIFIED entry names P0-04, which has no DONE entry, with an allowlisted en dash or a letter O", () => {
    expect(check(entry("VERIFIED", "P0-04, P0-06")).status).toBe(1);   // control: ASCII hyphen is caught
    const dash = check(entry("VERIFIED", "P0\u201304, P0-06"));
    const letterO = check(entry("VERIFIED", "PO-04, P0-06"));
    console.log("rv4 log E-B/E-C:", dash.status, dash.out.slice(0, 120), "|", letterO.status, letterO.out.slice(0, 120));
    expect({ dash: dash.status, letterO: letterO.status }).toEqual({ dash: 1, letterO: 1 });
  });

  it("DEFECT CHECK (rule 5): a UTF-16LE text file (Windows PowerShell 5 '>' default) with a JWT and an sb_secret_ key", () => {
    const secrets = `SUPABASE_SERVICE_ROLE_KEY=${JWT}\nKEY2=${SB_SECRET}\n`;
    expect(check(P, { "apps/web/status.txt": secrets }).status).toBe(1);   // control: the UTF-8 file is caught
    const r = check(P, { "apps/web/status.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(secrets, "utf16le")]) });
    console.log("rv4 log E-E:", r.status, r.out.slice(0, 120));
    expect(r.status).toBe(1);
  });

  it("FALSE POSITIVE CHECK (rule 5): ordinary app code assigning a token/password from an expression passes", () => {
    const lines = {
      optionalChain: "export const f = (data: any) => { const token = data?.session?.access_token; return token; };\n",
      formData: "export const f = (formData: FormData) => { const password = formData.get(\"password\"); return password; };\n",
      envBracket: "export const token = process.env[\"KIRAN_TOKEN\"];\n",
    };
    const got = Object.fromEntries(Object.entries(lines).map(([k, v]) => {
      const r = check(P, { "apps/web/lib/rv4.ts": v });
      return [k, r.status === 0 ? "pass" : r.out.split("\n")[1]?.trim() ?? r.out];
    }));
    console.log("rv4 log FP:", JSON.stringify(got));
    expect(got).toEqual({ optionalChain: "pass", formData: "pass", envBracket: "pass" });
  });
});
