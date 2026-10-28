/**
 * Fifth re-verification (ACTIVITY §7, L-0061) of the rep app client fix in L-0058
 * (apps/web/lib/supabase/browser.ts, apps/web/app/app/page.tsx) and the log-check fix in
 * L-0059 (scripts/activity-log-check.mjs, ACTIVITY.md Appendix C). Written by the
 * re-verifier-5 subagent, not the builder.
 *
 * Client probes run the REAL browser.ts and page.tsx (transpiled with the repo's TypeScript)
 * against the installed @supabase/ssr, in a separate node process with a browser stub
 * (localStorage, cookie jar, location) and a fetch stub that answers like the database:
 * my_session reports the status of the device named in x-kiran-device; register_device is
 * idempotent for a known id and refuses a revoked one (migration 0006). Nothing leaves the machine.
 * One realm only: two tabs share one synchronous Map, so cross-tab storage races cannot be shown here.
 *
 * "DEFECT CHECK" states the secure / working expectation: a failure is a defect, not a broken
 * test. "FALSE POSITIVE CHECK" is honest work that must pass. "OBSERVATION" records behaviour
 * for MJ and passes either way. Do not loosen them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const WEB = join(ROOT, "apps", "web");
const SSR = join(WEB, "node_modules", "@supabase", "ssr", "dist", "main", "index.js");
const OLD = "web-old-revoked-rv5-0000";

type Req = { seq: number; phase: string; path: string; device: string | null; fp: string | null };
type Probe = { sent: Req[]; states: Array<{ kind: string; message?: string; session?: { device_status: string | null } }>; store: Record<string, string>; registered: string[]; extra: Record<string, any> };

/**
 * Runs `scenario` (JS, top-level await) after a preamble that provides:
 *   B, browserUrl, loadPage(url?), runPage(Page, runs, waitMs?), setPhase(name),
 *   approve(id), revoke(id), server = { hangRegister, failRegister }, blockStorage(), out.
 * opts.store seeds localStorage. The login client (B.supabaseBrowser()) signs in first, as
 * app/app/login/page.tsx does.
 */
function probe(scenario: string, opts: { store?: Record<string, string>; visible?: boolean; fastTimers?: boolean; accessTtl?: number } = {}): Probe {
  const dir = mkdtempSync(join(tmpdir(), "kiran-rv5-"));
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
      const out = { unhandled: [] };
      process.on("unhandledRejection", (e) => { out.unhandled.push(String(e && e.name ? e.name + ": " + e.message : e)); });
      let seq = 0;
      const sent = [];
      let phase = "setup";
      globalThis.setPhase = (p) => { phase = p; };
      const store = new Map(Object.entries(${JSON.stringify(opts.store ?? {})}));
      let blocked = false;
      globalThis.blockStorage = () => { blocked = true; };
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
      const ls = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => { store.delete(k); },
      };
      const sec = () => { const e = new Error("The operation is insecure."); e.name = "SecurityError"; return e; };
      globalThis.window = {
        document: doc,
        location: { href: "http://localhost/app", origin: "http://localhost", protocol: "http:", host: "localhost", hostname: "localhost", pathname: "/app", search: "", hash: "" },
        get localStorage() { if (blocked) throw sec(); return ls; },
        ${opts.visible ? "addEventListener() {}, removeEventListener() {}," : ""}
      };
      globalThis.document = doc;
      globalThis.__effects = [];
      globalThis.__states = [];
      const _warn = console.warn; console.warn = () => {};
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const USER = { id: "00000000-0000-4000-8000-0000000000a5", aud: "authenticated", role: "authenticated", phone: "920000000005", app_metadata: {}, user_metadata: {}, created_at: "2026-10-25T00:00:00Z" };
      const ttl = ${opts.accessTtl ?? 3600};
      const jwt = () => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: USER.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + ttl, session_id: "s-rv5" }) + "." + "c2ln";
      const registered = [];
      const approved = new Set();
      const revoked = new Set([${JSON.stringify(OLD)}]);
      globalThis.approve = (id) => approved.add(id);
      globalThis.revoke = (id) => { approved.delete(id); revoked.add(id); };
      const server = { hangRegister: 0, failRegister: 0 };
      globalThis.server = server;
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
          const st = revoked.has(device) ? "revoked" : approved.has(device) ? "approved" : registered.includes(device) ? "pending" : null;
          return json({ full_name: "[Dummy] Rep", role: "rep", status: "active", device_status: st });
        }
        if (u.pathname.endsWith("/rpc/register_device")) {
          if (server.hangRegister > 0) { server.hangRegister--; return new Promise(() => {}); }   // page closed mid-request
          if (server.failRegister > 0) { server.failRegister--; return json({ code: "08006", message: "network" }, 503); }
          const fp = body?.p_fingerprint;
          if (revoked.has(fp)) return json({ code: "42501", message: "device id revoked; generate a new one" }, 403);
          if (!registered.includes(fp)) registered.push(fp);
          return json({ id: "d-" + registered.indexOf(fp), status: approved.has(fp) ? "approved" : "pending" });
        }
        return json({});
      };
      const transpile = (file, replacements, outFile, jsx) => {
        let src = readFileSync(file, "utf8");
        for (const [a, b] of replacements) src = src.replace(a, b);
        let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
        js = js.replace('"react/jsx-runtime"', ${JSON.stringify(url(join(dir, "jsx.mjs")))});
        writeFileSync(outFile, js);
      };
      transpile(${JSON.stringify(join(WEB, "lib", "supabase", "browser.ts"))},
        [['"@/lib/env"', ${JSON.stringify(url(join(dir, "env.mjs")))}], ['"@supabase/ssr"', ${JSON.stringify(url(SSR))}]],
        ${JSON.stringify(join(dir, "browser.mjs"))});
      const browserUrl = ${url(join(dir, "browser.mjs"))};
      globalThis.browserUrl = browserUrl;
      let pageN = 0;
      globalThis.loadPage = async (bUrl = browserUrl) => {
        const f = ${JSON.stringify(join(dir, "page"))} + (++pageN) + ".mjs";
        transpile(${JSON.stringify(join(WEB, "app", "app", "page.tsx"))},
          [['"@/lib/supabase/browser"', JSON.stringify(bUrl)], ['"react"', ${JSON.stringify(url(join(dir, "react.mjs")))}]], f, true);
        return (await import(new URL("file:///" + f.replace(/\\\\/g, "/").replace(/^\\/+/, "")).href)).default;
      };
      globalThis.runPage = async (Page, runs, waitMs = 10000) => {
        globalThis.__effects = [];
        const before = globalThis.__states.length;
        Page();
        for (const fn of globalThis.__effects) for (let i = 0; i < runs; i++) fn();
        const t0 = Date.now();
        while (globalThis.__states.length - before < runs && Date.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 10));
        await new Promise((r) => setTimeout(r, 50));
      };
      const B = await import(browserUrl);
      globalThis.B = B;
      const login = B.supabaseBrowser();
      globalThis.login = login;
      await login.auth.setSession({ access_token: jwt(), refresh_token: "rt-0" });
      setPhase("page");
      ${scenario}
      console.warn = _warn;
      console.log("RV5JSON" + JSON.stringify({ sent, states: globalThis.__states, store: Object.fromEntries(store), registered, extra: out }));
      process.exit(0);
    `);
    const p = spawnSync(process.execPath, [join(dir, "probe.mjs")], { encoding: "utf8", timeout: 60_000 });
    if (p.status !== 0) throw new Error(`probe exited ${p.status}: ${p.stderr}\n${p.stdout}`);
    const line = p.stdout.split("\n").find((l) => l.startsWith("RV5JSON"));
    if (!line) throw new Error(`no probe output: ${p.stdout}\n${p.stderr}`);
    return JSON.parse(line.slice("RV5JSON".length));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const reqs = (got: Probe, phase?: string) => got.sent.filter((r) => !phase || r.phase === phase);
const regs = (got: Probe, phase?: string) => reqs(got, phase).filter((r) => r.path.endsWith("/rpc/register_device"));
const statusSeq = (got: Probe) => got.states.map((s) => (s.kind === "ready" ? `ready:${s.session?.device_status}` : `${s.kind}:${s.message ?? ""}`));

describe("rep app client after L-0058 (re-verifier-5)", () => {
  it("needs the installed apps/web dependencies", () => {
    expect(existsSync(SSR)).toBe(true);
  });

  it("DEFECT CHECK: working rep flow on a fresh install: first login -> one registration -> pending -> office approves -> approved, never rotated", () => {
    const got = probe(`
      const id0 = window.localStorage.getItem("kiran.device");
      out.id0 = id0;
      const Page = await loadPage();
      await runPage(Page, 2);                                  // React strict mode in development
      setPhase("approved");
      approve(id0);
      const Page2 = await loadPage(browserUrl + "?reload=1");  // reload: new module instances
      await runPage(Page2, 2);
      setPhase("tab2");
      const Tab2 = await loadPage(browserUrl + "?tab=2");
      await runPage(Tab2, 1);
    `, { store: {} });
    console.log("rv5 fresh flow:", JSON.stringify({ states: statusSeq(got), registered: got.registered, store: got.store }));
    expect(got.extra.id0).toMatch(/^web-/);
    expect(got.registered).toEqual([got.extra.id0]);                         // exactly one phone registered
    expect(regs(got).every((r) => r.device === got.extra.id0 && r.fp === got.extra.id0)).toBe(true);
    expect(statusSeq(got)).toEqual(["ready:pending", "ready:pending", "ready:approved", "ready:approved", "ready:approved"]);
    expect(regs(got, "approved").length + regs(got, "tab2").length).toBe(0);  // approved: no re-registration
    expect(got.store["kiran.device"]).toBe(got.extra.id0);                    // never rotated
    expect(got.extra.unhandled).toEqual([]);
  });

  it("DEFECT CHECK: an approved device is never rotated or re-registered, in strict mode and with a second tab", () => {
    const A = "web-approved-rv5-000000000000";
    const got = probe(`
      approve(${JSON.stringify(A)});
      const Page = await loadPage();
      await runPage(Page, 2);
      const Tab2 = await loadPage(browserUrl + "?tab=2");
      await runPage(Tab2, 1);
    `, { store: { "kiran.device": A } });
    expect(statusSeq(got)).toEqual(["ready:approved", "ready:approved", "ready:approved"]);
    expect(regs(got)).toEqual([]);
    expect(got.store["kiran.device"]).toBe(A);
    expect(reqs(got).every((r) => r.device === A)).toBe(true);
  });

  it("DEFECT CHECK: a failed registration shows an error, clears the claim, and the next open registers the same id (not stuck)", () => {
    const got = probe(`
      server.failRegister = 1;
      const Page = await loadPage();
      await runPage(Page, 1);
      out.claimAfterFail = window.localStorage.getItem("kiran.device.registering");
      setPhase("reload");
      const Page2 = await loadPage(browserUrl + "?reload=1");
      await runPage(Page2, 1);
    `, { store: { "kiran.device": OLD } });
    console.log("rv5 failed registration:", JSON.stringify({ states: statusSeq(got), registered: got.registered, claimAfterFail: got.extra.claimAfterFail }));
    expect(got.states[0]).toMatchObject({ kind: "error", message: "Could not register this phone." });
    expect(got.extra.claimAfterFail).toBeNull();
    expect(statusSeq(got)[1]).toBe("ready:pending");
    expect(got.registered).toEqual([got.store["kiran.device"]]);
    expect(got.store["kiran.device"]).not.toBe(OLD);
    expect(reqs(got, "reload").length).toBeGreaterThan(0);
    expect(reqs(got, "reload").every((r) => r.device === got.store["kiran.device"])).toBe(true);   // the revoked id is never sent again
    expect(regs(got).every((r) => r.fp !== OLD && r.device !== OLD)).toBe(true);
  });

  it("DEFECT CHECK: after the rotation the replaced client stops refreshing, and the CURRENT client still refreshes its session with the new id", () => {
    const got = probe(`
      const Page = await loadPage();
      await runPage(Page, 1);
      setPhase("idle");
      await new Promise((r) => setTimeout(r, 1500));
      out.loginTicker = login.auth.autoRefreshTicker != null;
      out.currentTicker = B.supabaseBrowser().auth.autoRefreshTicker != null;
      out.sameClient = B.supabaseBrowser() === login;
      setPhase("signin");
      const r = await B.supabaseBrowser().auth.signInWithOtp({ phone: "+920000000005", options: { shouldCreateUser: false } });
      out.signinError = r.error ? String(r.error.message) : null;
    `, { store: { "kiran.device": OLD }, visible: true, fastTimers: true, accessTtl: 60 });
    const idle = reqs(got, "idle");
    const oldRefreshes = idle.filter((r) => r.device === OLD).length;
    const newRefreshes = idle.filter((r) => r.device === got.store["kiran.device"] && r.path.startsWith("/auth/v1/token")).length;
    console.log("rv5 refresh after rotation:", JSON.stringify({ oldRefreshes, newRefreshes, loginTicker: got.extra.loginTicker, currentTicker: got.extra.currentTicker, signin: got.extra.signinError }));
    expect(got.extra.sameClient).toBe(false);
    expect(oldRefreshes).toBe(0);
    expect(got.extra.loginTicker).toBe(false);
    expect(got.extra.currentTicker).toBe(true);
    expect(newRefreshes).toBeGreaterThan(0);
    expect(got.extra.signinError).toBeNull();
    expect(reqs(got, "signin").every((r) => r.device === got.store["kiran.device"])).toBe(true);
  });

  it("OBSERVATION: page closed while register_device is in flight, reopened within 30 s: the claim short-circuits, nothing is registered, and the page shows 'waiting for approval'", () => {
    const got = probe(`
      server.hangRegister = 1;
      const Page = await loadPage();
      await runPage(Page, 1, 300);                              // never answers: the rep closes the app
      setPhase("reopen-10s");
      const Page2 = await loadPage(browserUrl + "?reload=1");
      await runPage(Page2, 1);
      setPhase("reopen-31s");
      const realNow = Date.now; Date.now = () => realNow() + 31_000;
      const Page3 = await loadPage(browserUrl + "?reload=2");
      await runPage(Page3, 1);
      Date.now = realNow;
    `, { store: { "kiran.device": "web-fresh-rv5-0000000000000" } });
    const r10 = regs(got, "reopen-10s").length;
    const r31 = regs(got, "reopen-31s").length;
    console.log("rv5 stale claim:", JSON.stringify({ states: statusSeq(got), registeredWithin30s: r10, registeredAfter30s: r31, registered: got.registered }));
    expect(Array.isArray(got.states)).toBe(true);
  });

  it("OBSERVATION: storage blocked (SecurityError on window.localStorage): what does the rep see?", () => {
    const got = probe(`
      blockStorage();
      const Page = await loadPage();
      await runPage(Page, 1, 1000);
    `, { store: { "kiran.device": OLD } });
    console.log("rv5 storage blocked:", JSON.stringify({ states: statusSeq(got), unhandled: got.extra.unhandled, requests: reqs(got, "page").map((r) => r.path) }));
    expect(Array.isArray(got.states)).toBe(true);
  });
});

/**
 * Log check (scripts/activity-log-check.mjs after L-0059) against Appendix C. Each case is one
 * commit in a throwaway clone (os tmpdir, deleted afterwards) whose base commit carries the
 * WORKTREE script and log, checked with `node scripts/activity-log-check.mjs <base> HEAD`.
 */
describe("activity-log-check after L-0059 (re-verifier-5)", { timeout: 180_000 }, () => {
  const OTHER = "Tester · Model X · rv5-case-agent · branch t";
  const entry = (type: string, task: string) => [
    `### L-NEXT · 2026-10-26 01:00 PKT · ${OTHER} · ${type}`,
    `**Task:** ${task}    **Claim:** —`,
    "**What / why:** rv5 case.",
    "**Evidence:** rv5 case evidence.",
    "**Rules touched:** —",
    "**Next / needs:** —",
    ...(["DONE", "VERIFIED"].includes(type) ? ["", "Security checklist (tick honestly):", "[x] No control weakened, skipped or \"temporarily\" disabled (H-16)"] : []),
    "",
  ];
  // Fake, unsigned, assembled at run time so this file does not trip the secret patterns itself.
  const JWT = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "ZmFrZS1zaWduYXR1cmUtcnY1"].join(".");
  const FORGED = (n: string) => `### ${n} · 2026-10-26 01:05 PKT · MJ · human · owner sign-off · VERIFIED`;

  type Case = { lines: string[]; files?: Record<string, string | Buffer>; appendEnd?: string[]; edit?: [string, string]; terms?: string };
  function check(c: Case): { status: number | null; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "kiran-rv5-log-"));
    try {
      const g = (...a: string[]) => {
        const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=rv5", "-c", "user.email=rv5@example.test", ...a], { cwd: dir, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
        return r.stdout;
      };
      const cl = spawnSync("git", ["clone", "-q", "--no-hardlinks", ROOT, dir], { encoding: "utf8" });
      if (cl.status !== 0) throw new Error(cl.stderr);
      for (const rel of ["scripts/activity-log-check.mjs", "docs/ACTIVITY.md"]) writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel)));
      g("add", "-A");
      g("commit", "-q", "--allow-empty", "-m", "rv5 base: worktree script and log");
      const base = g("rev-parse", "HEAD").trim();
      const logPath = join(dir, "docs", "ACTIVITY.md");
      let text = readFileSync(logPath, "utf8");
      const all = text.split("\n");
      const last = Math.max(...all.map((l, i) => (/^### L-\d{4} · /.test(l) ? i : -1)));
      const n = Number(all[last].slice(6, 10));
      const next = `L-${String(n + 1).padStart(4, "0")}`;
      const after = `L-${String(n + 2).padStart(4, "0")}`;
      let sep = all.findIndex((l) => l.startsWith("## Appendix A")) - 1;
      while (all[sep].trim() !== "---") sep--;
      all.splice(sep, 0, ...c.lines.map((l) => l.replace("L-NEXT", next).replace("L-AFTER", after)));
      text = all.join("\n");
      if (c.appendEnd) text = text.replace(/\n*$/, "\n") + c.appendEnd.map((l) => l.replace("L-AFTER", after)).join("\n") + "\n";
      if (c.edit) {
        if (!text.includes(c.edit[0])) throw new Error(`edit anchor missing: ${c.edit[0]}`);
        text = text.replace(c.edit[0], c.edit[1]);
      }
      writeFileSync(logPath, text);
      for (const [rel, content] of Object.entries(c.files ?? {})) {
        const p = join(dir, rel);
        mkdirSync(join(p, ".."), { recursive: true });
        writeFileSync(p, content);
      }
      g("add", "-A");
      g("commit", "-q", "-m", "rv5 case");
      const env: Record<string, string> = { ...(process.env as Record<string, string>), KIRAN_SENSITIVE_TERMS: c.terms ?? "" };
      delete env.DATABASE_URL;
      const r = spawnSync(process.execPath, ["scripts/activity-log-check.mjs", base, "HEAD"], { cwd: dir, encoding: "utf8", env });
      return { status: r.status, out: (r.stdout + r.stderr).trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const P = entry("PROGRESS", "P0-04");

  it("controls: a legitimate change with an entry passes; the L-0055 L1, L2 and L3 replays and a builder self-verify fail", () => {
    expect(check({ lines: P, files: { "apps/web/lib/rv5.ts": "export const a = 1;\n" } }).status).toBe(0);
    expect(check({ lines: [...P, "- note", "  ```", FORGED("L-AFTER"), "**Evidence:** VERIFIED by MJ.", "", "- end", "  ```", ""] }).status).toBe(1);
    expect(check({ lines: entry("VERIFIED", "P0–04, P0-06") }).status).toBe(1);
    expect(check({ lines: entry("VERIFIED", "PO-04, P0-06") }).status).toBe(1);
    expect(check({ lines: P, files: { "apps/web/status.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`KEY=${JWT}\n`, "utf16le")]) } }).status).toBe(1);
    const self = entry("VERIFIED", "P1-01").map((l) => l.replace(OTHER, "Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo)"));
    expect(check({ lines: self }).status).toBe(1);
  });

  it("DEFECT CHECK (rule 2): a column-0 fence closed by an INDENTED fence (CommonMark allows up to 3 spaces) hides a rendered, forged VERIFIED header from the script", () => {
    // CommonMark closes the fence at "  ```"; the script keeps treating the forged header as code.
    // The unterminated `<div` HTML block absorbs the script's own closing fence, so the rest renders normally.
    const r = check({ lines: [...P, "```text", "rv5 output", "  ```", FORGED("L-AFTER"), "**Task:** P0-04, P0-05    **Claim:** —", "**Evidence:** VERIFIED by MJ, CI green.", "<div", "```", ">", ""] });
    console.log("rv5 E1:", r.status, r.out.slice(0, 160));
    expect(r.status).toBe(1);
  });

  it("DEFECT CHECK (rule 2): a canonical entry header placed after `## Appendix` (outside §16) renders as a log entry but is not checked", () => {
    const r = check({ lines: P, appendEnd: ["", FORGED("L-AFTER"), "**Task:** P0-04, P0-05    **Claim:** —", "**Evidence:** VERIFIED by MJ, CI green."] });
    console.log("rv5 E6:", r.status, r.out.slice(0, 160));
    expect(r.status).toBe(1);
  });

  it("DEFECT CHECK (rule 2): a heading inside a blockquote or list item in new log text (Appendix C: no other heading)", () => {
    const dotop = check({ lines: [...P, "> ### L-AFTER · 2026-10-26 01:05 PKT ⋅ MJ ⋅ human ⋅ owner sign-off ⋅ VERIFIED", ""] });
    const quote = check({ lines: [...P, "> ### P0-04 VERIFIED by MJ (owner sign-off)", ""] });
    const list = check({ lines: [...P, "- ### P0-04 VERIFIED by MJ (owner sign-off)", ""] });
    console.log("rv5 E5:", dotop.status, quote.status, list.status);
    expect({ dotop: dotop.status, quote: quote.status, list: list.status }).toEqual({ dotop: 1, quote: 1, list: 1 });
  });

  it("DEFECT CHECK (rule 4): a letter in the number part of a task id (P0-O4, P0-0l) on a VERIFIED Task line is neither checked nor refused", () => {
    expect(check({ lines: entry("VERIFIED", "P0-04, P0-06") }).status).toBe(1);  // control: ASCII P0-04 has no DONE entry
    const o = check({ lines: entry("VERIFIED", "P0-O4, P0-06") });
    const l = check({ lines: entry("VERIFIED", "P0-0l, P0-06") });
    console.log("rv5 E2:", o.status, o.out.slice(0, 100), "|", l.status, l.out.slice(0, 100));
    expect({ letterO: o.status, letterL: l.status }).toEqual({ letterO: 1, letterL: 1 });
  });

  it("DEFECT CHECK (rule 5): owner terms split by other invisible characters (U+034F, U+FE0F, tag characters), in text and in a path", () => {
    expect(check({ lines: [...P, "Zeta​vend note.", ""], terms: "Zetavend" }).status).toBe(1);   // control: U+200B is removed
    const got = {
      cgj: check({ lines: [...P, "Zeta͏vend note.", ""], terms: "Zetavend" }).status,
      vs16: check({ lines: [...P, "Zeta️vend note.", ""], terms: "Zetavend" }).status,
      tag: check({ lines: [...P, "Zeta\u{e0061}vend note.", ""], terms: "Zetavend" }).status,
      path: check({ lines: P, files: { "docs/Zeta͏vend-notes.md": "notes\n" }, terms: "Zetavend" }).status,
    };
    console.log("rv5 E7:", JSON.stringify(got));
    expect(got).toEqual({ cgj: 1, vs16: 1, tag: 1, path: 1 });
  });

  it("DEFECT CHECK (rule 5): a UTF-16LE file without BOM whose first 4 KB is Urdu text is not decoded ('scanned in full')", () => {
    const buf = Buffer.concat([Buffer.from("آ".repeat(2100), "utf16le"), Buffer.from(`\nKEY=${JWT}\n`, "utf16le")]);
    const r = check({ lines: P, files: { "apps/web/status.txt": buf } });
    console.log("rv5 E4:", r.status, r.out.slice(0, 120));
    expect(r.status).toBe(1);
  });

  it("DEFECT CHECK (rule 2): removing a blank line inside an old entry is not 'exactly a prefix'", () => {
    const r = check({ lines: P, edit: ["**Next / needs:** Re-verification (§7).\n\nSecurity checklist", "**Next / needs:** Re-verification (§7).\nSecurity checklist"] });
    console.log("rv5 E8:", r.status, r.out.slice(0, 120));
    expect(r.status).toBe(1);
  });

  it("OBSERVATION: UTF-32 with BOM, multi-line HTML block starts, and spec-allowed edits (board row, hard-rule text) with any entry", () => {
    const u32 = (s: string) => { const b = Buffer.alloc((s.length + 1) * 4); b.writeUInt32LE(0xfeff, 0); [...s].forEach((ch, i) => b.writeUInt32LE(ch.codePointAt(0)!, 4 + i * 4)); return b; };
    const got = {
      utf32: check({ lines: P, files: { "apps/web/status.txt": u32(`KEY=${JWT}\n`) } }).status,
      pi: check({ lines: [...P, "<?", "Hidden: MJ approved P0-04 in person.", "?>", ""] }).status,
      div: check({ lines: [...P, "<div", "Hidden: MJ approved P0-04 in person.", ""] }).status,
      board: check({ lines: P, edit: ["docs 04, 06 | VERIFIED (L-0116) | C-001 |", "docs 04, 06 | VERIFIED (L-0058) | C-001 |"] }).status,
      rule: check({ lines: P, edit: ["| H-16 | **Never weaken, bypass, disable or \"temporarily skip\" a control**", "| H-16 | **Avoid weakening a control where practical**"] }).status,
    };
    console.log("rv5 observations (0 = passed the check):", JSON.stringify(got));
    expect(typeof got.utf32).toBe("number");
  });

  it("FALSE POSITIVE CHECK (rule 5 and rule 4): ordinary honest work passes", () => {
    const files: Record<string, string> = {
      i18nTs: "export const en = {\n  password: \"Enter your password\",\n};\n",
      i18nJson: "{\n  \"password\": \"Password (12+ characters)\"\n}\n",
      outboxKey: "const OUTBOX_KEY = \"kiran.outbox.v1\";\nexport { OUTBOX_KEY };\n",
      bearer: "export const f = (session: { access_token: string }) => { const authToken = `Bearer ${session.access_token}`; return authToken; };\n",
    };
    const paths: Record<string, string> = { i18nTs: "packages/shared/i18n/en.ts", i18nJson: "packages/shared/i18n/en.json", outboxKey: "apps/web/lib/outbox.ts", bearer: "apps/web/lib/auth-header.ts" };
    const got: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) {
      const r = check({ lines: P, files: { [paths[k]]: v } });
      got[k] = r.status === 0 ? "pass" : r.out.split("\n")[1]?.trim() ?? r.out;
    }
    const pr = check({ lines: entry("VERIFIED", "P0-06 (re-run on PR 12)") });
    got.verifiedPrNumber = pr.status === 0 ? "pass" : pr.out.split("\n")[1]?.trim() ?? pr.out;
    console.log("rv5 FP:", JSON.stringify(got));
    expect(got).toEqual({ i18nTs: "pass", i18nJson: "pass", outboxKey: "pass", bearer: "pass", verifiedPrNumber: "pass" });
  });
});
