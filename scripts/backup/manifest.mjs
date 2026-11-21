/**
 * Backup manifest and comparison (P1-12 Task 6; doc 06 section 10.7, "Backup restore drill
 * performed once before go-live, documented"; doc 06 section 5, Backups).
 *
 * A manifest is a snapshot of everything that must survive a restore: the applied migration
 * versions, every table's row count, whether each table forces RLS, the number of auth users,
 * and the head of the audit hash chain. `buildManifest` reads all of it inside ONE transaction,
 * so the counts and the audit head cannot come from different instants (a dump and a manifest
 * taken at different times would invent a difference, or hide a loss).
 *
 * `compareManifests` reports every difference by name and returns `[]` when the restored
 * database matches the source. `createdAt` is deliberately not compared: a dump and a restore
 * are taken at different times by definition, so only a difference in CONTENT is meaningful.
 *
 * Pure parts (`compareManifests`) are unit-tested by `scripts/backup/manifest.test.mjs`.
 * `buildManifest` is exercised end to end by the rehearsal in Task 8, against a real database.
 */

/**
 * @typedef {Object} AuditHead
 * @property {number} seq
 * @property {string} hash
 *
 * @typedef {Object} Manifest
 * @property {string} createdAt                 ISO timestamp; never compared.
 * @property {string[]} migrations              Applied migration versions, sorted.
 * @property {Record<string, number>} tables    "schema.table" -> row count.
 * @property {Record<string, boolean>} rlsForced "schema.table" -> pg_class.relforcerowsecurity.
 * @property {number} authUsers                 rows in auth.users (people must be able to sign in).
 * @property {AuditHead | null} auditHead       last control.audit_event row, or null when empty.
 */

/** The business schemas a backup carries. `supplier_vault` only once the vault exists (P1-05). */
const MANIFEST_SCHEMAS = "('public', 'control', 'app', 'supplier_vault')";

/** Every table in the business schemas, with the RLS flag the restore must reproduce. */
const TABLES = `
  select n.nspname || '.' || c.relname as t, c.relforcerowsecurity as forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname in ${MANIFEST_SCHEMAS}
   order by 1`;

const LEDGER = "supabase_migrations.schema_migrations";

/** `schema.table` as a quoted reference; a catalog name carrying a quote is refused, not escaped. */
function quotable(name) {
  const parts = String(name).split(".");
  if (parts.length !== 2 || parts.some((p) => p === "" || p.includes('"'))) {
    throw new Error(`refusing to quote a non "schema.table" name: ${name}`);
  }
  return parts.map((p) => `"${p}"`).join(".");
}

/**
 * Reads the manifest of a database in one transaction.
 *
 * The migration ledger is read when it exists. The Supabase CLI creates
 * `supabase_migrations.schema_migrations`; a plain Postgres (the embedded test stack, or a
 * database restored by `pg_restore`, which does not carry that schema) has none, and an absent
 * ledger is an empty list rather than an error. Task 7's dump therefore carries the ledger
 * explicitly so a restored manifest can match its source.
 *
 * @param {{ query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> }} client
 * @returns {Promise<Manifest>}
 */
export async function buildManifest(client) {
  await client.query("begin");
  try {
    const { rows: relations } = await client.query(TABLES);
    /** @type {Record<string, number>} */
    const tables = {};
    /** @type {Record<string, boolean>} */
    const rlsForced = {};
    for (const row of relations) {
      const t = String(row.t);
      tables[t] = 0;
      rlsForced[t] = Boolean(row.forced);
    }
    for (const t of Object.keys(tables)) {
      const { rows } = await client.query(`select count(*)::int n from ${quotable(t)}`);
      tables[t] = Number(rows[0].n);
    }

    const { rows: ledger } = await client.query(`select to_regclass('${LEDGER}') is not null as has`);
    const migrations = ledger[0].has
      ? (await client.query(`select version from ${LEDGER} order by version`)).rows.map((r) => String(r.version))
      : [];

    const { rows: users } = await client.query("select count(*)::int n from auth.users");
    const { rows: head } = await client.query("select seq, hash from control.audit_event order by seq desc limit 1");

    await client.query("commit");
    return {
      createdAt: new Date().toISOString(),
      migrations,
      tables,
      rlsForced,
      authUsers: Number(users[0].n),
      auditHead: head.length ? { seq: Number(head[0].seq), hash: String(head[0].hash) } : null,
    };
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

/**
 * Every difference between a source manifest and the manifest of the restored database.
 * `[]` means the restore is faithful. `createdAt` is ignored on purpose (see above).
 *
 * @param {Manifest} source
 * @param {Manifest} restored
 * @returns {string[]} one message per difference, in a stable order
 */
export function compareManifests(source, restored) {
  /** @type {string[]} */
  const problems = [];

  for (const m of source.migrations) {
    if (!restored.migrations.includes(m)) problems.push(`migration ${m} is missing after the restore`);
  }
  for (const m of restored.migrations) {
    if (!source.migrations.includes(m)) problems.push(`migration ${m} is new after the restore`);
  }

  for (const t of Object.keys(source.tables)) {
    if (!(t in restored.tables)) {
      problems.push(`${t}: the table is gone after the restore`);
    } else if (source.tables[t] !== restored.tables[t]) {
      problems.push(`${t}: ${source.tables[t]} rows before, ${restored.tables[t]} after`);
    }
  }
  for (const t of Object.keys(restored.tables)) {
    if (!(t in source.tables)) problems.push(`${t}: the table is new after the restore`);
  }

  for (const t of Object.keys(source.rlsForced)) {
    if (!(t in restored.rlsForced)) {
      problems.push(`${t}: the RLS flag is gone after the restore`);
    } else if (source.rlsForced[t] && !restored.rlsForced[t]) {
      problems.push(`${t}: RLS is no longer forced after the restore`);
    }
  }

  if (source.authUsers !== restored.authUsers) {
    problems.push(`auth users: ${source.authUsers} before, ${restored.authUsers} after`);
  }

  const head = (h) => (h === null ? "none" : `${h.seq}/${h.hash}`);
  if (head(source.auditHead) !== head(restored.auditHead)) {
    problems.push(`audit head: ${head(source.auditHead)} before, ${head(restored.auditHead)} after`);
  }

  return problems;
}
