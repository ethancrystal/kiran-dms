// One-command runner for the e2e-stack suite against a REAL local Supabase stack.
// Usage: pnpm test:e2e:stack [-- <playwright args>], e.g.
//   pnpm test:e2e:stack -- e2e-stack/roles-coverage.spec.ts
//   pnpm test:e2e:stack -- --stop        (stop the stack afterwards)
// Only the public URL and the anon/publishable key leave `supabase status`; no
// service-role key is ever read or passed (H-18). It refuses to seed anything but
// 127.0.0.1/localhost. On this Windows host the CLI and Docker live in WSL, so the
// stack commands run through `wsl` when the native CLI is unavailable.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const stopAfter = args.includes("--stop");
const playwrightArgs = args.filter((a) => a !== "--stop");

function run(cmd, cmdArgs, env = process.env, capture = false) {
  const r = spawnSync(cmd, cmdArgs, { stdio: capture ? "pipe" : "inherit", env, shell: false });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} exited ${r.status}`);
  return capture ? r.stdout.toString() : "";
}

// Resolve a command on the host or inside WSL (this repo's Windows host has no native Docker).
function resolver() {
  const has = (c) => spawnSync("bash", ["-lc", `command -v ${c}`], { stdio: "ignore" }).status === 0;
  if (has("supabase") && has("docker")) return { cmd: (c, a, e, cap) => run(c, a, e, cap) };
  const wslHas = (c) => spawnSync("wsl", ["bash", "-lc", `command -v ${c}`], { stdio: "ignore" }).status === 0;
  if (wslHas("supabase") && wslHas("docker")) {
    return { cmd: (c, a, e, cap) => run("wsl", ["bash", "-lc", `${c} ${a.map((x) => JSON.stringify(x)).join(" ")}`], e, cap) };
  }
  throw new Error("Supabase CLI and Docker not found on the host or in WSL. Run scripts/wsl-install-supabase.sh first.");
}

const { cmd } = resolver();
const EXCLUDED = "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

try {
  console.log("Starting local Supabase stack (db, auth, rest, gateway, mail, storage)");
  cmd("supabase", ["start", "-x", EXCLUDED]);

  const raw = cmd("supabase", ["status", "-o", "json"], process.env, true);
  const status = JSON.parse(raw);
  const apiUrl = status.API_URL;
  const publicKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  if (!apiUrl || !publicKey) throw new Error("supabase status did not return API_URL and a public key");
  const u = new URL(apiUrl);
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
    throw new Error(`refusing a non-local stack URL (${u.hostname})`);
  }
  // DB and Mailpit are fixed local ports in supabase/config.toml (54322 / 54324).
  const dbUrl = `postgresql://postgres:postgres@127.0.0.1:54322/postgres`;
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
    KIRAN_STACK_DB_URL: dbUrl,
    KIRAN_STACK_MAILPIT_URL: "http://127.0.0.1:54324",
  };
  // Confirm the ports are reachable before seeding.
  for (const [name, value] of [
    ["API", apiUrl],
    ["DB", dbUrl],
    ["Mailpit", env.KIRAN_STACK_MAILPIT_URL],
  ]) {
    console.log(`${name}: ${value}`);
  }

  console.log("Seeding synthetic people");
  run(process.execPath, ["scripts/e2e-stack-seed.mjs", "apps/web/e2e-stack/.seed.json"], env);

  console.log("Running e2e-stack Playwright suite");
  run("pnpm", ["-C", "apps/web", "exec", "playwright", "test", "-c", "playwright.stack.config.ts", ...playwrightArgs], env);
} finally {
  if (stopAfter) {
    console.log("Stopping local Supabase stack");
    try {
      cmd("supabase", ["stop", "--no-backup"]);
    } catch (e) {
      console.warn(String(e));
    }
  }
}
