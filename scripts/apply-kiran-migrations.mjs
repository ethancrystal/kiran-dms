// Applies the migrations not yet recorded (after office_orders_cards) to the Kiran project, one transaction each,
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
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const REF = "iurvazdyxzlspegygldo";
const LAST_APPLIED = "office_orders_cards";
// Every migration from the first after office_orders_cards on, in file-name order.
const FIRST_PENDING = "20261105100000";
const FILES = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql") && f >= FIRST_PENDING)
  .map((f) => f.slice(0, -".sql".length))
  .sort();
// Recorded under other names on the project: audit_fixes went in as three parts on 2026-11-05.
const RECORDED_AS = { audit_fixes: ["audit_fixes_part1_of_3", "audit_fixes_part2_of_3", "audit_fixes_part3_of_3"] };
const isRecorded = (names, name) => (RECORDED_AS[name] ?? [name]).every((n) => names.includes(n));

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
  const todo = FILES.filter((f) => !isRecorded(names, f.slice(f.indexOf("_") + 1)));
  if (!names.includes(LAST_APPLIED)) {
    throw new Error(`Expected ${LAST_APPLIED} to be applied already. Stop and tell Claude what differs.`);
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
