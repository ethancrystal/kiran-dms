// P1-34 (public shop, plan C): load the [Dummy] catalogue MJ showed into a LOCAL database.
// Follows scripts/e2e-stack-seed.mjs: it refuses any host other than 127.0.0.1 or localhost, and
// it never uses a service-role key. The rows and the run logic live in scripts/lib/dummy-catalogue.mjs
// so supabase/tests/catalogue-seed.test.ts exercises the same code.
//
// Usage (PowerShell):
//   $env:KIRAN_STACK_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   node scripts/dummy-catalogue-seed.mjs --dry-run
//   node scripts/dummy-catalogue-seed.mjs
// Options: --dry-run  list what would change, write nothing
//          --owner=<uuid>  act as this existing owner instead of the first active owner
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertLocalDatabaseUrl, DUMMY_CATALOGUE, DUMMY_PRICE_PAISA, runDummyCatalogueSeed } from "./lib/dummy-catalogue.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("usage: KIRAN_STACK_DB_URL=<local url> node scripts/dummy-catalogue-seed.mjs [--dry-run] [--owner=<uuid>]");
  process.exit(0);
}

const url = process.env.KIRAN_STACK_DB_URL;
assertLocalDatabaseUrl(url);

const dryRun = args.includes("--dry-run");
const ownerArg = args.find((a) => a.startsWith("--owner="))?.slice("--owner=".length);
const unknown = args.filter((a) => a !== "--dry-run" && !a.startsWith("--owner="));
if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(" ")}`);

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const actorId = await resolveOwner(c, ownerArg, dryRun);
  const result = await runDummyCatalogueSeed(c, { actorId, dryRun });

  if (result.conflicts.length > 0) {
    console.error(`[Dummy] catalogue seed: ${result.conflicts.length} seeded SKU(s) carry a price this seed did not write:`);
    for (const conflict of result.conflicts) console.error(`  keep ${conflict}`);
    console.error("Refusing to overwrite a real price (B-54, H-04).");
    process.exitCode = 1;
  } else {
    const changed = result.changes.filter((ch) => ch.action !== "unchanged");
    if (dryRun) {
      console.log(`[Dummy] catalogue seed dry run: ${changed.length} row(s) would change; nothing was written.`);
      for (const ch of changed) {
        console.log(`  would ${ch.action.padEnd(7)} ${ch.kind.padEnd(8)} ${ch.label}${ch.detail ? `  (${ch.detail})` : ""}`);
      }
    } else {
      console.log(`[Dummy] catalogue seed applied: ${changed.length} row(s) changed.`);
      for (const ch of changed) {
        console.log(`  ${ch.action.padEnd(7)} ${ch.kind.padEnd(8)} ${ch.label}${ch.detail ? `  (${ch.detail})` : ""}`);
      }
    }
    console.log(
      `[Dummy] ${DUMMY_CATALOGUE.groups.length} groups, ${DUMMY_CATALOGUE.products.length} products, ` +
        `${DUMMY_CATALOGUE.skus.length} SKUs at the placeholder price of ${DUMMY_PRICE_PAISA} paisa (Rs 111.11).`,
    );
    console.log(
      `[Dummy] rows before: ${countsText(result.before)}; rows after: ${countsText(dryRun ? result.before : result.after)}.`,
    );
  }
} finally {
  await c.end();
}

function countsText(n) {
  return `${n.groups} groups, ${n.products} products, ${n.skus} SKUs, ${n.pricedSkus} priced`;
}

async function resolveOwner(client, explicit, dryRun) {
  if (explicit) {
    const { rows } = await client.query(
      "select id from public.user_profile where id = $1::uuid and role = 'owner' and status = 'active'",
      [explicit],
    );
    if (!rows[0]) throw new Error(`no active owner with id ${explicit}`);
    return rows[0].id;
  }
  const { rows } = await client.query(
    "select id from public.user_profile where role = 'owner' and status = 'active' order by created_at limit 1",
  );
  if (rows[0]) return rows[0].id;
  if (dryRun) throw new Error("no owner yet; run once without --dry-run to bootstrap [Dummy] Catalogue Seed Owner");

  // No owner yet on this local stack: bootstrap a [Dummy] one, the way the database test fixtures
  // and scripts/e2e-stack-seed.mjs do. Local only: the URL guard above has already refused anything else.
  const id = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [
    id,
    "catalogue-seed@example.test",
  ]);
  await client.query("select app.bootstrap_owner($1, $2)", [id, "[Dummy] Catalogue Seed Owner"]);
  console.log("[Dummy] no owner existed; bootstrapped [Dummy] Catalogue Seed Owner for this local stack.");
  return id;
}
