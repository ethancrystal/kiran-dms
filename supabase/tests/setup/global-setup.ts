/**
 * Builds a throwaway database for the RLS / invariant suite (NFR-12, ACTIVITY P0-06):
 *   1. KIRAN_TEST_DATABASE_URL set (never the ambient DATABASE_URL) (CI: supabase/postgres service container, or `supabase start`)
 *      → use that database as is. It must be fresh.
 *   2. otherwise → start an embedded Postgres 17 in a temp dir (no Docker, no install).
 * Then applies the Supabase shim (only if auth.users is missing), every migration in
 * filename order, and the shared persona fixtures.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createFixtures } from "./fixtures";

const ROOT = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "supabase", "tests", "shim", "supabase-shim.sql");

export default async function setup(project: TestProject) {
  let url = process.env.KIRAN_TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;

  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = mkdtempSync(join(tmpdir(), "kiran-pg-"));
    const port = 55000 + Math.floor(Math.random() * 2000);
    const server = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--auth=scram-sha-256"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase("kiran_test");
    url = `postgresql://postgres:postgres@127.0.0.1:${port}/kiran_test`;
    stop = async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ has: boolean }>("select to_regclass('auth.users') is not null as has");
    if (!rows[0].has) await client.query(readFileSync(SHIM, "utf8"));

    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      try {
        await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
      } catch (e) {
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    const fixtures = await createFixtures(client);
    project.provide("databaseUrl", url);
    project.provide("fixtures", fixtures);
  } finally {
    await client.end();
  }

  return async () => {
    if (stop) await stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    fixtures: import("./fixtures").Fixtures;
  }
}
