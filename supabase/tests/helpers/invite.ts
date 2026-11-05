/**
 * Helpers for the invitation and salon tests (migration 20261105100000, slice 1): a login with no
 * profile, which the shared personas cannot be, and scripts that run as that login the way PostgREST
 * would (SET LOCAL ROLE + request.jwt.claims). The amr claim is what GoTrue signs into the token:
 * "otp" for an emailed code, "password" for a password sign-in.
 */
import { randomUUID } from "node:crypto";
import { errorOf, run, sqlstate } from "./db";

export type Login = { id: string; email: string; session: string };
export type Method = "otp" | "magiclink" | "password";

export const uuid = () => randomUUID();
export const tag = () => randomUUID().slice(0, 8);
export const quote = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);

type NewLogin = { email?: string; confirmed?: boolean; password?: string };

/** A signed-up auth user with no profile and no membership, committed. Synthetic address (H-03). */
export async function newLogin({ email, confirmed = true, password }: NewLogin = {}): Promise<Login> {
  const id = uuid();
  const address = email ?? `invitee.${tag()}@example.test`;
  await run(
    "postgres",
    "insert into auth.users (id, email, email_confirmed_at, encrypted_password) values ($1, $2, $3, $4)",
    [id, address, confirmed ? new Date().toISOString() : null, password ?? null],
    { commit: true },
  );
  return { id, email: address, session: uuid() };
}

/** SQL that switches the transaction to this login. */
export function asLogin(l: Login, method: Method = "otp") {
  const claims = JSON.stringify({
    sub: l.id,
    role: "authenticated",
    aal: "aal1",
    session_id: l.session,
    email: l.email,
    amr: [{ method, timestamp: 1 }],
  });
  return `reset role;
    select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '{}', true);
    set local role authenticated;`;
}

type Multi = Array<{ rows: Array<Record<string, unknown>> }>;

/** Runs sql as the login and returns the rows of its last statement. */
export async function asLoginRows(l: Login, sql: string, opts: { commit?: boolean; method?: Method } = {}) {
  const res = (await run("postgres", `${asLogin(l, opts.method)} ${sql}`, [], { commit: opts.commit })) as unknown as Multi;
  return res.at(-1)?.rows ?? [];
}
export const asLoginCode = (l: Login, sql: string, method?: Method) => sqlstate("postgres", `${asLogin(l, method)} ${sql}`);
export const asLoginError = (l: Login, sql: string, method?: Method) => errorOf("postgres", `${asLogin(l, method)} ${sql}`);

/** Every relation in our five schemas, for "this login sees nothing" sweeps. */
export const ALL_RELATIONS = `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname in ('public', 'control', 'supplier_vault', 'app', 'vault_api') order by 1`;
