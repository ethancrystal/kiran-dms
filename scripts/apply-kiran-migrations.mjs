// Applies the 13 pending migrations (after office_orders_cards) to the Kiran project, one transaction each,
// and records each in supabase_migrations.schema_migrations the way the project's earlier ones were recorded
// (applied-time version, snake_case name). MJ runs this with his own connection string; nothing here reads
// or prints a secret, and it refuses any database that is not the Kiran project.
//
//   $env:KIRAN_DB_URL = "<the Kiran project's direct or pooler connection string, typed by you>"
//   node scripts/apply-kiran-migrations.mjs --dry-run     (reads, checks, prints the plan, writes nothing)
//   node scripts/apply-kiran-migrations.mjs               (applies)
//
// H-19: run it only with MJ's approval of exactly this change. Stops at the first error; the failing
// migration is rolled back whole, and the ones before it stay applied and recorded.
import { readFileSync } from "node:fs";
import pg from "pg";

const REF = "iurvazdyxzlspegygldo";
const LAST_APPLIED = "office_orders_cards";
const EXPECTED_COUNT = 25;
const FILES = [
  "20261105100000_invitations_salon_approval",
  "20261105110000_catalogue_prices",
  "20261105120000_investor_ledger",
  "20261105130000_delivery_approval_enums",
  "20261105130100_delivery_approval",
  "20261105140000_commission",
  "20261105150000_requests_portal",
  "20261105160000_rep_readonly_timelines",
  "20261105170000_office_pending_approvals",
  "20261105180000_overviews",
  "20261105190000_office_documents_rep_detail",
  "20261105220000_invoice_composer_signature",
  "20261105230000_audit_fixes",
];

const url = process.env.KIRAN_DB_URL ?? "";
const dry = process.argv.includes("--dry-run");
if (!url) throw new Error("Set KIRAN_DB_URL to the Kiran project's connection string first.");
if (!url.includes(REF)) throw new Error(`That connection string is not the Kiran project (${REF}). Nothing was done.`);

const stamp = (i) => {
  const d = new Date(Date.now() + i * 1000);
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
};

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const { rows } = await c.query("select version, name from supabase_migrations.schema_migrations order by version");
  const names = rows.map((r) => r.name);
  console.log(`Kiran has ${rows.length} migrations; the last is ${names.at(-1)}.`);
  const todo = FILES.filter((f) => !names.includes(f.slice(f.indexOf("_") + 1)));
  if (todo.length === FILES.length && (rows.length !== EXPECTED_COUNT || names.at(-1) !== LAST_APPLIED)) {
    throw new Error(`Expected ${EXPECTED_COUNT} migrations ending at ${LAST_APPLIED}. Stop and tell Claude what differs.`);
  }
  console.log(`${todo.length} to apply:`);
  for (const f of todo) console.log(`  ${f}`);
  if (dry) {
    console.log("Dry run: nothing written.");
  } else {
    let i = 0;
    for (const f of todo) {
      const sql = readFileSync(new URL(`../supabase/migrations/${f}.sql`, import.meta.url), "utf8");
      process.stdout.write(`applying ${f} ... `);
      try {
        await c.query("begin");
        await c.query(sql);
        await c.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [
          stamp(i++),
          f.slice(f.indexOf("_") + 1),
        ]);
        await c.query("commit");
        console.log("ok");
      } catch (e) {
        await c.query("rollback");
        console.log("FAILED, rolled back");
        throw e;
      }
    }
    const after = await c.query("select count(*)::int n from supabase_migrations.schema_migrations");
    console.log(`Done. Kiran now has ${after.rows[0].n} migrations.`);
  }
} finally {
  await c.end();
}
