/**
 * Doc 06 section 10, criterion 3: a rep acts only with TOTP (office) and from an approved device (rep). A
 * function a client can call must not be able to skip that gate, now or when a later migration adds one.
 * The function list is read from the catalog, never typed by hand: a new function is swept the day it appears.
 *
 * What the sweep proves, and what it does not:
 *   - Proves: the body of every function that `authenticated` or `anon` can execute, in our five schemas,
 *     CALLS one of GATES (a call, not a comment or a string, and a boolean gate not thrown away by PERFORM),
 *     or is on the ALLOWLIST with a reason that is itself checked against the body. A new function that
 *     skips the gate shows up here at once.
 *   - Proves, separately: each gate still has the parts that make it a gate (GATE_DEFS needs), so weakening
 *     app.assert_actor_ready itself (dropping the device or AAL2 test) is reported, not just a missing call.
 *   - Does NOT prove: that the gate is reached on every path (a call inside one branch counts), or that a
 *     boolean gate's result is used correctly. The behaviour is proved by device-guard, rls-matrix and the
 *     per-module negative tests (anonymous, wrong role, wrong device, AAL1). This file is the safety net
 *     that makes sure no callable function is left out of those.
 *   - Treats app.self_ok and app.rep_device_ok as DEVICE-ONLY gates: both are true for every active owner or
 *     manager even at AAL1 (rep_device_ok returns true for every non-rep), so they prove the rep's phone and
 *     nothing about TOTP. A function that passes only on one of them must also carry a rep-only marker in its
 *     body (REP_MARKERS: user_role() = 'rep', my_bag_id, my_territory_ids, rep_can_reach_salon), or a full gate;
 *     otherwise it is reported (DEVICE_ONLY). The two that have neither today are named in
 *     DEVICE_ONLY_EXCEPTIONS, one as a DEFECT with its own DEFECT CHECK at the end of this file, one accepted.
 *   - Still does NOT prove that a marker is enforced on every path (it is read as text, like the gates).
 *
 * How a function that only calls ANOTHER gated function is treated: it does NOT count. Only the helpers in
 * GATES count, and each helper that wraps another gate (rep_can_reach_salon, can_see_salon_money,
 * assert_salon_money) is itself proved, by GATE_DEFS needs, to call the gate it wraps. So the chain is explicit
 * and one hop at a time; a business function that calls app.record_payment (no gate of its own) is reported.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";
import { claims } from "./setup/fixtures";

const SCHEMAS = "('public', 'control', 'app', 'supplier_vault', 'vault_api')";
const DENIED = "42501";
// 187 functions at the time of writing; the floors only have to stop the sweep from collapsing to nothing.
const MIN_CALLABLE = 150;
const MIN_GATED = 100;
const MIN_POLICY_USES = 10;
const CODE_LENGTH = 8;

/** `user_role() = 'rep'`, or `user_role() is distinct from 'rep'` (the refusing form): the body is for reps only. */
const REP_ROLE = "app[.]user_role[(][)][[:space:]]*(=|is[[:space:]]+distinct[[:space:]]+from)[[:space:]]*'rep'";

/** SQL regex source for a call of `schema.name(`: the name must end at the parenthesis. */
const callOf = (fn: string) => `${fn.replace(".", "[.]")}[[:space:]]*[(]`;

type Gate = {
  fn: string;
  /** assert_*: raises when the caller fails. Otherwise a boolean: calling it with PERFORM checks nothing. */
  raises: boolean;
  /** True for the two gates that prove the rep's phone only: true for every non-rep, so no TOTP test (see DEVICE_ONLY). */
  deviceOnly?: boolean;
  /** Regexes (SQL, case-insensitive, on the body without comments) that must all still match. */
  needs: string[];
};

// The gates, found by reading the migrations. Every one is defined once; where, and what it checks:
//  - assert_actor_ready, assert_office, assert_owner: 20261024223304_foundation.sql. Active profile; office
//    roles need AAL2 (TOTP); a rep needs an approved device. assert_office / assert_owner add the role.
//  - self_ok: 20261024232225_device_hardening.sql. Active profile, and a rep on the approved device.
//  - rep_device_ok: foundation, last redefined in 20261105230000_audit_fixes.sql. A rep needs the emailed-code
//    session AND a device row that is approved and matches the sha256 of the x-kiran-device header.
//  - is_office, is_owner: foundation. Owner/manager (owner) role AND AAL2.
//  - has_vault_grant: foundation. Owner/manager with the vault grant AND AAL2.
//  - rep_can_reach_salon: 20261105100000_invitations_salon_approval.sql. self_ok + the rep holds the salon.
//  - can_see_salon_money (20261103154528_payments.sql): is_office or rep_can_reach_salon.
//  - assert_salon_money (same file): raises unless can_see_salon_money.
//  - assert_salon_member: 20261105150000_requests_portal.sql. The salon portal's gate: an active salon
//    membership on an emailed-code session, and no staff profile (app.my_salon_id). A rep or office login
//    never passes it, so a function behind it cannot be reached by one of them.
const GATE_DEFS: Gate[] = [
  {
    fn: "app.assert_actor_ready",
    raises: true,
    needs: [callOf("app.user_role"), callOf("app.is_aal2"), callOf("app.rep_device_ok"), callOf("app.raise_denied")],
  },
  { fn: "app.assert_office", raises: true, needs: [callOf("app.assert_actor_ready"), callOf("app.raise_denied")] },
  { fn: "app.assert_owner", raises: true, needs: [callOf("app.assert_actor_ready"), callOf("app.raise_denied")] },
  { fn: "app.self_ok", raises: false, deviceOnly: true, needs: [callOf("app.user_role"), callOf("app.rep_device_ok")] },
  {
    fn: "app.rep_device_ok",
    raises: false,
    deviceOnly: true,
    needs: [
      callOf("app.rep_session_ok"),
      callOf("app.request_device_id"),
      callOf("app.fingerprint_hash"),
      "public[.]device",
      "status[[:space:]]*=[[:space:]]*'approved'",
    ],
  },
  { fn: "app.is_office", raises: false, needs: [callOf("app.user_role"), callOf("app.is_aal2")] },
  { fn: "app.is_owner", raises: false, needs: [callOf("app.user_role"), callOf("app.is_aal2")] },
  { fn: "app.has_vault_grant", raises: false, needs: [callOf("app.is_aal2"), "vault_grant"] },
  {
    fn: "app.rep_can_reach_salon",
    raises: false,
    needs: [callOf("app.self_ok"), callOf("app.rep_holds_salon"), REP_ROLE],
  },
  { fn: "app.can_see_salon_money", raises: false, needs: [callOf("app.is_office"), callOf("app.rep_can_reach_salon")] },
  { fn: "app.assert_salon_money", raises: true, needs: [callOf("app.can_see_salon_money"), callOf("app.raise_denied")] },
  { fn: "app.assert_salon_member", raises: true, needs: [callOf("app.my_salon_id"), callOf("app.raise_denied")] },
];
const GATES: string[] = GATE_DEFS.map((g) => g.fn);

// Rep-only markers: a body that carries one cannot be passed by an owner or manager, so a device-only gate beside
// it is enough. Verified against the latest definitions: my_bag_id and my_territory_ids (20261105230000_audit_fixes)
// return rows only when `app.user_role() = 'rep'`; rep_can_reach_salon (20261105100000) tests `user_role() = 'rep'`.
// The call markers are checked like gates (GATE_GAPS: each still tests the rep role). `markerCalls` are function names.
const REP_MARKER_CALLS = ["app.my_bag_id", "app.my_territory_ids", "app.rep_can_reach_salon"];
const MARKER_DEFS: Array<{ fn: string; needs: string[] }> = [
  { fn: "app.my_bag_id", needs: [REP_ROLE] },
  { fn: "app.my_territory_ids", needs: [REP_ROLE] },
];

// Functions that pass only on a device-only gate and carry no rep-only marker, so an owner or manager at AAL1 passes
// them. Each is named with its status; an entry that no longer matches (function gone, or now gated) fails.
const DEVICE_ONLY_EXCEPTIONS: Array<{ fn: string; status: "DEFECT" | "ACCEPTED"; note: string }> = [
  {
    fn: "app.warehouse_availability()",
    status: "DEFECT",
    note: "Filter is `self_ok() and user_role() is not null`: an owner or manager without TOTP reads the warehouse quantities. Finding for MJ; see the DEFECT CHECK at the end of this file.",
  },
  {
    fn: "app.may_read_product_images()",
    status: "ACCEPTED",
    note: '`self_ok() or salon member`: office at AAL1 may read product pictures on purpose, pinned by catalogue-prices.test.ts ("pictures: who may read the product-images bucket", MANAGER_AAL1 expected true).',
  },
];

type AllowEntry = {
  /** schema.name(argument types), exactly as the catalog prints it, so a new overload is not covered. */
  fn: string;
  reason: string;
  /** Regexes (SQL, case-insensitive, on the body without comments) that must all match: the reason is checked, not just written. */
  proof: string[];
};

// Functions a caller can execute that call no gate. Each reason can be checked against the function
// (and `proof` checks the part of the body the reason relies on). Nothing here is a business operation:
// each is a way in before a gate can exist (no device, no profile yet), the gates' own primitives, or a
// function that refuses everyone.
const NO_PROFILE_YET = (what: string) =>
  `Runs before this login has a staff profile or a device, so there is nothing to gate on yet. ${what}`;
const ALLOWLIST: AllowEntry[] = [
  // ---- a way in before a device or profile exists
  {
    fn: "app.register_device(text, text, text)",
    reason:
      "Must work before a device exists: it creates the caller's own pending device row (auth.uid()), which only an office user " +
      "can approve through app.approve_device (gated by assert_office). Refuses a caller with no active profile, and a rep without " +
      "the emailed-code session. Cannot approve or use a device.",
    proof: ["app[.]user_role[(][)][[:space:]]+is[[:space:]]+null", callOf("app.rep_session_ok"), "insert into public[.]device"],
  },
  {
    fn: "app.my_session()",
    reason:
      "Must work on an unapproved device: it is how the phone learns its own device status (device-hardening 0004, item 3). " +
      "Returns only the caller's own profile row (id = auth.uid()) and, for a rep, only on the emailed-code session. No business data.",
    proof: ["p[.]id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]", callOf("app.rep_session_ok")],
  },
  {
    fn: "app.redeem_invitation(text)",
    reason: NO_PROFILE_YET(
      "It is what creates the profile or the salon membership. It needs an emailed-code session (session_proved_email), " +
        "the token's hash and the login's own confirmed email, and refuses a login that already has a staff profile or a salon account.",
    ),
    proof: [callOf("app.session_proved_email"), callOf("app.invitation_hash"), "already has a staff account"],
  },
  {
    fn: "app.invitation_preview(text)",
    reason: NO_PROFILE_YET(
      "Read-only. Returns the invitation only for an emailed-code session whose own confirmed email matches the invitation; " +
        "an unknown token, another email or a password session all read null.",
    ),
    proof: [callOf("app.session_proved_email"), "lower[(]au[.]email[)][[:space:]]*=[[:space:]]*i[.]email"],
  },
  {
    fn: "app.salon_apply(uuid, text, text, salon_type, text)",
    reason: NO_PROFILE_YET(
      "A salon signup request. It needs an emailed-code session, and refuses a login that already has a staff profile or a salon account. " +
        "It never creates a user_profile (reps are invitation-only).",
    ),
    proof: [callOf("app.session_proved_email"), "already has a staff account", "salon_signup_request"],
  },
  {
    fn: "app.salon_me()",
    reason:
      "Salon portal entry check. Returns only the caller's own active salon membership (user_id = auth.uid()) on an emailed-code " +
      "session; null for everyone else. Read-only, allow-listed fields.",
    proof: ["m[.]user_id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]", callOf("app.session_proved_email")],
  },
  {
    fn: "app.salon_login_status()",
    reason:
      "Tells a salon login whether it is a member or an applicant, before it has a membership to gate on. Returns only the caller's " +
      "own membership or signup request (user_id = auth.uid()) on an emailed-code session. Read-only.",
    proof: [
      "m[.]user_id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]",
      "r[.]user_id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]",
      callOf("app.session_proved_email"),
    ],
  },
  // ---- a function that refuses everyone
  {
    fn: "app.create_order(uuid, uuid, plan_code, delivery_mode, jsonb, uuid, timestamp with time zone)",
    reason:
      "Retired by D-30 (reps record order cards instead). Its first statement raises 42501 for every caller, so no role can get " +
      "past it and nothing is read or written. Kept so an old phone build gets a clear refusal instead of 'function does not exist'. " +
      "A separate test below calls it as every persona.",
    proof: [
      "^[[:space:]]*begin[[:space:]]+raise[[:space:]]+exception[[:space:]]+using[[:space:]]+errcode[[:space:]]*=[[:space:]]*'42501'",
    ],
  },
  // ---- the gates' own primitives: a boolean or a string about the caller's own session, no table of business data
  {
    fn: "app.user_role()",
    reason:
      "The primitive every gate is built on: the caller's own role (null when there is no active profile). Reads one row by auth.uid(). " +
      "Returns nothing about anyone else.",
    proof: ["p[.]id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]"],
  },
  {
    fn: "app.is_aal2()",
    reason:
      "Reads the aal claim of the caller's own JWT. Ingredient of is_office, is_owner and assert_actor_ready (GATE_DEFS needs checks that they use it). Reads no table.",
    proof: ["auth[.]jwt[(][)]"],
  },
  {
    fn: "app.is_rep()",
    reason:
      "A role-only boolean about the caller (no device, no AAL). Reads no table. The policies that use it also require self_ok " +
      "(checked by the policy test below), so it never opens a row on its own.",
    proof: [callOf("app.user_role")],
  },
  {
    fn: "app.request_device_id()",
    reason:
      "Echoes the caller's own x-kiran-device request header. Reads no table; the sha256 of it is what rep_device_ok compares.",
    proof: ["x-kiran-device"],
  },
  // ---- RLS helpers that return the caller's own ids
  {
    fn: "app.my_bag_id()",
    reason:
      "RLS helper: returns the caller's own rep-bag id, and only for a rep on an emailed-code session (a uuid, no stock figures). " +
      "It has no device test of its own; the policy test below proves every policy that uses it also requires self_ok.",
    proof: [
      callOf("app.rep_session_ok"),
      "app[.]user_role[(][)][[:space:]]*=[[:space:]]*'rep'",
      "owner_user_id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]",
    ],
  },
  {
    fn: "app.my_territory_ids()",
    reason:
      "RLS helper: returns the caller's own open territory ids, and only for a rep on an emailed-code session. It has no device test " +
      "of its own; the policy test below proves every policy that uses it also requires self_ok.",
    proof: [
      callOf("app.rep_session_ok"),
      "app[.]user_role[(][)][[:space:]]*=[[:space:]]*'rep'",
      "rt[.]rep_id[[:space:]]*=[[:space:]]*auth[.]uid[(][)]",
    ],
  },
];

// ---------------------------------------------------------------- the guard, as SQL --------------------

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
// Body without comments (block and line), then also without string literals. Gates are looked for in
// `bare`, so a gate named in a comment or an error message does not count; GATE_DEFS needs and `proof` read `code`.
const CODE = (col: string) =>
  `regexp_replace(regexp_replace(${col}, '/[*].*?[*]/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g')`;
const BARE = (code: string) => `regexp_replace(${code}, '''([^'']|'''')*''', '', 'g')`;

// A raising gate counts when it is called; a boolean gate counts when it is called and not by PERFORM.
const GATED = (bare: string, gates: Gate[]) =>
  gates
    .map((g) =>
      g.raises
        ? `${bare} ~* ${lit(callOf(g.fn))}`
        : `regexp_replace(${bare}, ${lit(`perform[[:space:]]+${callOf(g.fn)}`)}, '', 'gi') ~* ${lit(callOf(g.fn))}`,
    )
    .join("\n        or ");

const FULL_GATES = GATE_DEFS.filter((g) => !g.deviceOnly);
const DEVICE_GATES = GATE_DEFS.filter((g) => g.deviceOnly);
// A rep-only marker is a role test (read in `code`, where the literal 'rep' still is) or a call of a rep-only helper.
const MARKED = (code: string, bare: string) =>
  [`${code} ~* ${lit(REP_ROLE)}`, ...REP_MARKER_CALLS.map((fn) => `${bare} ~* ${lit(callOf(fn))}`)].join(" or ");

const GATE_NAMES = `array[${GATES.map(lit).join(", ")}]::text[]`;

// Every function in our schemas that authenticated or anon can execute (extension-owned ones excluded).
const INVENTORY = `
  with f as (
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' sig,
           n.nspname || '.' || p.proname name,
           has_function_privilege('authenticated', p.oid, 'execute') auth,
           has_function_privilege('anon', p.oid, 'execute') anon,
           ${CODE("p.prosrc")} code
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ${SCHEMAS}
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  g as (select f.*, ${BARE("f.code")} bare from f),
  h as (select g.*, (${GATED("bare", FULL_GATES)}) full_g, (${GATED("bare", DEVICE_GATES)}) dev_g, (${MARKED("code", "bare")}) marked from g)
  select sig, name, auth, anon, code,
         (full_g or (dev_g and marked)) gated,
         (dev_g and not full_g and not marked) device_only,
         name = any (${GATE_NAMES}) is_gate
  from h`;

// The functions the sweep reports before the allowlist: executable, not a gate itself, no gate called at all.
const UNGATED = `select sig t from (${INVENTORY}) i where not gated and not device_only and not is_gate order by 1`;
// Executable, not a gate itself, and passing only on a device-only gate with no rep-only marker.
const DEVICE_ONLY = `select sig t from (${INVENTORY}) i where device_only and not is_gate order by 1`;

// Gates whose definition is missing, duplicated, or lacks one of the parts that makes it a gate.
const GATE_VALUES = [...GATE_DEFS, ...MARKER_DEFS].flatMap((g) => g.needs.map((n) => `(${lit(g.fn)}, ${lit(n)})`)).join(", ");
const GATE_GAPS = `
  with need(fn, re) as (values ${GATE_VALUES}),
  def as (
    select n.nspname || '.' || p.proname fn, count(*) over (partition by p.proname) copies, ${CODE("p.prosrc")} code
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app')
  select distinct need.fn t from need
  left join def on def.fn = need.fn
  where def.fn is null or def.copies <> 1 or def.code !~* need.re
  order by 1`;

type Row = {
  sig: string;
  name: string;
  auth: boolean;
  anon: boolean;
  code: string;
  gated: boolean;
  device_only: boolean;
  is_gate: boolean;
};
const inventory = async (): Promise<Row[]> => (await run("postgres", INVENTORY)).rows;
const ungated = async () => (await run("postgres", UNGATED)).rows.map((r) => r.t as string);

// Run setup statements and a guard in one rolled-back transaction; return the guard's rows.
const planted = async (setup: string, guard: string) => {
  const res = (await run("postgres", `${setup}; ${guard}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
  return res[res.length - 1].rows.map((r) => r.t);
};
const onlyPlanted = (rows: string[]) => rows.filter((t) => t.includes("zz_planted"));
const plantedUngated = async (setup: string) => onlyPlanted(await planted(setup, UNGATED));
const plantedDeviceOnly = async (setup: string) => onlyPlanted(await planted(setup, DEVICE_ONLY));

/** What is wrong with the exception list: a function that is gone, or one that no longer passes on a device-only gate alone. */
async function exceptionProblems(list: Array<{ fn: string }>): Promise<string[]> {
  const stillDeviceOnly = new Set((await run("postgres", DEVICE_ONLY)).rows.map((r) => r.t as string));
  return list
    .filter((e) => !stillDeviceOnly.has(e.fn))
    .map((e) => `${e.fn}: stale, it no longer passes on a device-only gate alone`);
}

/**
 * What is wrong with an allowlist: an entry listed twice, one that matches no executable function, one for a
 * function that now calls a gate (stale), one for a gate (gates are proved by GATE_DEFS needs), and one whose
 * `proof` regexes no longer match the body (the reason has stopped being true). Works on any list, so the
 * guard itself is tested against a planted one.
 */
async function allowlistProblems(list: Array<Pick<AllowEntry, "fn" | "proof">>): Promise<string[]> {
  const repeated = list.filter((e, i) => list.findIndex((x) => x.fn === e.fn) !== i).map((e) => `${e.fn}: listed twice`);
  const { rows } = await run(
    "postgres",
    `select e.fn, i.sig is null missing, coalesce(i.is_gate, false) is_gate, coalesce(i.gated, false) gated,
            coalesce((select array_agg(re) from jsonb_array_elements_text(e.proof) re where i.code !~* re), '{}') unproven
     from jsonb_to_recordset($1::jsonb) e(fn text, proof jsonb)
     left join (${INVENTORY}) i on i.sig = e.fn`,
    [JSON.stringify(list)],
  );
  return [
    ...repeated,
    ...rows.flatMap((r) => [
      ...(r.missing ? [`${r.fn}: stale, no such function that a client can execute`] : []),
      ...(r.is_gate ? [`${r.fn}: is a gate; gates are proved by GATE_DEFS needs, not allowlisted`] : []),
      ...(r.gated ? [`${r.fn}: stale, it now calls a gate; remove it from the allowlist`] : []),
      ...(r.unproven as string[])
        .map((re) => (r.missing ? "" : `${r.fn}: its reason no longer holds, body lacks /${re}/`))
        .filter(Boolean),
    ]),
  ];
}

// ---------------------------------------------------------------- tests -------------------------------

describe("every function a client can call passes a gate (doc 06 10.3)", () => {
  it("the gates exist once each in schema app and still have the parts that make them gates", async () => {
    expect((await run("postgres", GATE_GAPS)).rows).toEqual([]);
  });

  it("finds the callable functions by catalog, and the sweep is not vacuous", async () => {
    const rows = await inventory();
    expect(rows.length).toBeGreaterThanOrEqual(MIN_CALLABLE);
    expect(rows.filter((r) => r.gated).length).toBeGreaterThanOrEqual(MIN_GATED);
    // A sample of the three families (office write, rep write, rep read): all found, all gated.
    const sample = ["app.office_set_sku_price", "app.rep_record_payment", "app.owner_set_role", "app.my_day", "app.rep_check_in"];
    expect(sample.filter((n) => !rows.some((r) => r.name === n && r.gated))).toEqual([]);
    // Only schema app has callable functions today: if another schema gains one, it is swept like the rest.
    expect([...new Set(rows.map((r) => r.name.split(".")[0]))]).toEqual(["app"]);
  });

  it("every function that authenticated or anon can execute calls a gate, or is on the allowlist with a reason", async () => {
    const allowed = new Set(ALLOWLIST.map((e) => e.fn));
    expect((await ungated()).filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("every function that passes only on a device-only gate (self_ok, rep_device_ok) also carries a rep-only marker, or is a named exception", async () => {
    // self_ok is true for an owner or manager at AAL1: a new office-reachable function gated by it alone has no TOTP test.
    const named = new Set(DEVICE_ONLY_EXCEPTIONS.map((e) => e.fn));
    const found = (await run("postgres", DEVICE_ONLY)).rows.map((r) => r.t as string);
    expect(found.filter((f) => !named.has(f))).toEqual([]);
  });

  it("every device-only exception still exists and still passes on a device-only gate alone (a fixed one must leave the list)", async () => {
    expect(await exceptionProblems(DEVICE_ONLY_EXCEPTIONS)).toEqual([]);
    expect(DEVICE_ONLY_EXCEPTIONS.map((e) => e.status).sort()).toEqual(["ACCEPTED", "DEFECT"]);
  });

  it("every allowlist entry still exists, still calls no gate, and its reason still holds in the body", async () => {
    expect(await allowlistProblems(ALLOWLIST)).toEqual([]);
  });

  it("anon can execute no function in our schemas", async () => {
    // A login is needed for everything, even the invitation preview. A function granted to anon on purpose
    // needs this assertion changed in review, with the reason written down.
    expect((await inventory()).filter((r) => r.anon).map((r) => r.sig)).toEqual([]);
  });

  it("the retired app.create_order refuses every persona (it is allowlisted because it refuses everyone)", async () => {
    const call = "select app.create_order(null, null, null, null, null, null, null)";
    const personas: Array<[string, Who]> = [
      ["owner", OWNER],
      ["manager", MANAGER],
      ["rep", REP_A],
      ["anon", "anon"],
    ];
    const codes = await Promise.all(personas.map(async ([label, who]) => [label, await sqlstate(who, call)] as const));
    expect(codes).toEqual(personas.map(([label]) => [label, DENIED]));
    expect(await errorOf(OWNER, call)).toContain("reps no longer place orders");
  });

  it("the ungated RLS helpers on the allowlist are only used by policies that also require self_ok", async () => {
    // my_bag_id, my_territory_ids and is_rep carry no device test of their own. A policy using one of them
    // without self_ok would open rows to a rep on an unapproved phone, so each such policy is read here.
    const uses = "app[.](my_bag_id|my_territory_ids|is_rep)[[:space:]]*[(]";
    const expr =
      "coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')";
    const { rows } = await run(
      "postgres",
      `select c.relname || '.' || pol.polname t from pg_policy pol join pg_class c on c.oid = pol.polrelid
       where ${expr} ~* '${uses}' and ${expr} !~* 'app[.]self_ok[[:space:]]*[(]' order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual([]);
    // Not vacuous: policies do use them.
    const used = await run("postgres", `select count(*)::int n from pg_policy pol where ${expr} ~* '${uses}'`);
    expect(used.rows[0].n).toBeGreaterThanOrEqual(MIN_POLICY_USES);
  });
});

describe("the guards report what they should (planted functions, rolled back)", () => {
  // Each function is created in a rolled-back transaction and granted to authenticated, as a migration would.
  const make = (name: string, body: string, opts: { lang?: string; schema?: string; grant?: string } = {}) => {
    const schema = opts.schema ?? "app";
    const fn = `${schema}.zz_planted_${name}()`;
    const code = opts.lang === "sql" ? `select ${body}` : `begin ${body} end`;
    const grant = opts.grant ?? "to authenticated";
    return `create function ${fn} returns ${opts.lang === "sql" ? "boolean" : "void"} language ${opts.lang ?? "plpgsql"}
      security definer set search_path = '' as $f$ ${code} $f$;
      ${grant ? `grant execute on function ${fn} ${grant}` : `revoke execute on function ${fn} from public, anon, authenticated`}`;
  };
  const flagged = (name: string, schema = "app") => [`${schema}.zz_planted_${name}()`];
  // A call of each gate in the form a function would use it (raising ones with PERFORM, boolean ones in an IF).
  const callOfGate = (g: Gate) => {
    const args =
      g.fn.endsWith("reach_salon") || g.fn.endsWith("see_salon_money") || g.fn.endsWith("salon_money") ? "(null)" : "()";
    return g.raises ? `perform ${g.fn}${args};` : `if ${g.fn}${args} then null; end if;`;
  };

  it("reports a function with no gate, and does not report one that calls each kind of gate", async () => {
    expect(await plantedUngated(make("open", "perform 1;"))).toEqual(flagged("open"));
    const results = await Promise.all(
      GATE_DEFS.map(async (g) => [g.fn, await plantedUngated(make("gated", callOfGate(g)))] as const),
    );
    expect(results).toEqual(GATE_DEFS.map((g) => [g.fn, []]));
    // A full gate leaves nothing for the device-only check; a device-only gate alone is reported by that check instead.
    const deviceOnly = await Promise.all(
      GATE_DEFS.map(async (g) => [g.fn, await plantedDeviceOnly(make("gated", callOfGate(g)))] as const),
    );
    expect(deviceOnly).toEqual(GATE_DEFS.map((g) => [g.fn, g.deviceOnly ? flagged("gated") : []]));
  });

  it("a function gated only by app.self_ok is reported unless it carries a rep-only marker or a full gate", async () => {
    const cases: Array<[string, string, boolean]> = [
      ["selfonly", "if app.self_ok() then null; end if;", true],
      ["deviceonly", "if app.rep_device_ok() then null; end if;", true],
      // The marker must be real: in a comment, a string, or as the excluding form (<>) it does not make a body rep-only.
      [
        "commentmark",
        `-- app.user_role() = 'rep'
        if app.self_ok() then null; end if;`,
        true,
      ],
      ["stringmark", "if app.self_ok() then raise notice 'user_role() = rep'; end if;", true],
      ["notrep", "if app.self_ok() and app.user_role() <> 'rep' then null; end if;", true],
      ["repmark", "if app.self_ok() and app.user_role() = 'rep' then null; end if;", false],
      ["refusing", "if app.user_role() is distinct from 'rep' or not app.self_ok() then null; end if;", false],
      ["bagmark", "if app.self_ok() and app.my_bag_id() is not null then null; end if;", false],
      ["terrmark", "if app.self_ok() and app.my_territory_ids() is not null then null; end if;", false],
      ["reachmark", "if app.self_ok() and app.rep_can_reach_salon(null) then null; end if;", false],
      ["fullgate", "if app.self_ok() and app.is_office() then null; end if;", false],
      ["raisegate", "perform app.self_ok(); perform app.assert_office();", false],
    ];
    const found = await Promise.all(
      cases.map(async ([name, body]) => [name, await plantedDeviceOnly(make(name, body))] as const),
    );
    expect(found).toEqual(cases.map(([name, , reported]) => [name, reported ? flagged(name) : []]));
    // A device gate whose call is thrown away by PERFORM is no gate at all: reported as ungated, not as device-only.
    expect(await plantedUngated(make("dropped", "perform app.self_ok(); perform 1;"))).toEqual(flagged("dropped"));
  });

  it("the exception check reports a function that is gone or now properly gated", async () => {
    expect(await exceptionProblems([{ fn: "app.warehouse_availability()" }])).toEqual([]);
    expect(await exceptionProblems([{ fn: "app.my_day()" }])).toEqual([
      "app.my_day(): stale, it no longer passes on a device-only gate alone",
    ]);
    expect(await exceptionProblems([{ fn: "app.no_such_function()" }])).toHaveLength(1);
  });

  it("reports a boolean gate that is called and thrown away, a look-alike name, and a gate named only in a comment or a string", async () => {
    const cases: Array<[string, string]> = [
      ["discard", "perform app.is_office();"],
      ["discard2", "perform app.self_ok();"],
      ["lookalike", "perform app.assert_office_not();"],
      [
        "line",
        `-- perform app.assert_office();
        perform 1;`,
      ],
      ["block", "/* perform app.assert_office(); */ perform 1;"],
      ["text", "raise notice 'call app.assert_office() first';"],
      // A string with an escaped quote, and a comment holding an apostrophe, are both read correctly.
      [
        "quote",
        `raise notice 'it''s app.assert_office()'; -- don't
        perform 1;`,
      ],
    ];
    const found = await Promise.all(cases.map(async ([name, body]) => [name, await plantedUngated(make(name, body))] as const));
    expect(found).toEqual(cases.map(([name]) => [name, flagged(name)]));
    expect(
      await plantedUngated(
        make(
          "real",
          `-- don't forget
        perform app.assert_office();`,
        ),
      ),
    ).toEqual([]);
  });

  it("reports an ungated function in any of our schemas, and one granted to anon; ignores one nobody can execute", async () => {
    expect(await plantedUngated(make("pub", "perform 1;", { schema: "public" }))).toEqual(flagged("pub", "public"));
    expect(await plantedUngated(make("ctl", "perform 1;", { schema: "control", grant: "to authenticated" }))).toEqual(
      flagged("ctl", "control"),
    );
    expect(await plantedUngated(make("anon", "perform 1;", { grant: "to anon" }))).toEqual(flagged("anon"));
    expect(await plantedUngated(make("nobody", "perform 1;", { grant: "" }))).toEqual([]);
  });

  it("reads a language-sql function like any other", async () => {
    expect(await plantedUngated(make("sqlopen", "true", { lang: "sql" }))).toEqual(flagged("sqlopen"));
    expect(await plantedUngated(make("sqlgated", "app.is_office()", { lang: "sql" }))).toEqual([]);
  });

  it("reports a gate that has been weakened, dropped or given a second overload (GATE_DEFS needs)", async () => {
    // assert_office replaced by a body that no longer calls assert_actor_ready: every office function would still
    // "call a gate" by name, so only this check notices.
    const weakOffice = `create or replace function app.assert_office() returns public.app_role language plpgsql
      stable set search_path = '' as $f$ begin return 'owner'; end $f$`;
    expect(await planted(weakOffice, GATE_GAPS)).toEqual(["app.assert_office"]);
    // rep_device_ok that no longer looks at the device table.
    const weakDevice = `create or replace function app.rep_device_ok() returns boolean language sql stable security definer
      set search_path = '' as $f$ select app.rep_session_ok() $f$`;
    expect(await planted(weakDevice, GATE_GAPS)).toContain("app.rep_device_ok");
    expect(await planted("drop function app.has_vault_grant()", GATE_GAPS)).toContain("app.has_vault_grant");
    const overload = "create function app.self_ok(p int) returns boolean language sql as $f$ select true $f$";
    expect(await planted(overload, GATE_GAPS)).toContain("app.self_ok");
  });

  it("the allowlist check reports a repeated, missing, gated, gate or unproven entry", async () => {
    const fine = { fn: "app.is_aal2()", proof: ["auth[.]jwt[(][)]"] };
    expect(await allowlistProblems([fine])).toEqual([]);
    expect(await allowlistProblems([fine, fine])).toEqual(["app.is_aal2(): listed twice"]);
    expect(await allowlistProblems([{ fn: "app.no_such_function()", proof: [] }])).toHaveLength(1);
    expect(await allowlistProblems([{ fn: "app.my_day()", proof: [] }])).toEqual([
      "app.my_day(): stale, it now calls a gate; remove it from the allowlist",
    ]);
    expect(await allowlistProblems([{ fn: "app.is_office()", proof: [] }])).toEqual([
      "app.is_office(): is a gate; gates are proved by GATE_DEFS needs, not allowlisted",
    ]);
    expect(await allowlistProblems([{ fn: "app.is_aal2()", proof: ["delete from"] }])).toEqual([
      "app.is_aal2(): its reason no longer holds, body lacks /delete from/",
    ]);
  });
});

// A gate that is present but too weak for a caller it lets through. self_ok is the rep device gate: it is true for
// every active profile that is not a rep, so an owner or manager WITHOUT TOTP passes it. A function whose only gate is
// self_ok must therefore also require the rep role (my_day does: self_ok and user_role() = 'rep'); the sweep above
// cannot see that difference, so each such function found by reading the list is checked here.
//   - app.may_read_product_images: office at AAL1 may read it on purpose, pinned in catalogue-prices.test.ts. Accepted.
//   - app.warehouse_availability: its only filter is `self_ok() and user_role() is not null`, so the office reads the
//     warehouse's available quantity per SKU without TOTP. Not pinned by any test: a finding for MJ.
describe("self_ok alone does not enforce TOTP for the office", () => {
  // One rolled-back transaction: the manager (AAL2) makes a catalogue row and a warehouse, then the session claims are
  // switched to the same manager at the given AAL and the function is read. The AAL2 run proves the plant works.
  const warehouseRowsAt = async (aal: "aal1" | "aal2") => {
    const [group, product, sku, store] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const code = `ZZGATE-${randomUUID().slice(0, CODE_LENGTH).toUpperCase()}`;
    // The refusal 42501 counts as no rows: the defect is "rows are visible at AAL1", so either fix (no rows, or a
    // refusal) ends it and turns the DEFECT CHECK red. Any other error still surfaces.
    try {
      const res = (await run(
        MANAGER,
        `select app.office_upsert_product_group('${group}', '[Test] gate group', 21);
         select app.office_upsert_product('${product}', '${group}', '[Test] gate brand', '[Test] gate product');
         select app.office_upsert_sku('${sku}', '${product}', '${code}', '[Test] shade', 'ml', 100);
         select app.office_create_location('${store}', 'warehouse', '[Test] gate store');
         select set_config('request.jwt.claims', ${lit(claims(fx.manager.id, aal))}, true);
         select count(*)::int n from app.warehouse_availability() where sku_id = '${sku}'`,
      )) as unknown as Array<{ rows: Array<{ n: number }> }>;
      return res[res.length - 1].rows[0].n;
    } catch (e) {
      if ((e as { code?: string }).code === DENIED) return 0;
      throw e;
    }
  };

  it("baseline: with TOTP the office sees the planted SKU in app.warehouse_availability()", async () => {
    expect(await warehouseRowsAt("aal2")).toBe(1);
  });

  it.fails("DEFECT CHECK: an office session without TOTP (AAL1) must not read app.warehouse_availability()", async () => {
    expect(await warehouseRowsAt("aal1")).toBe(0);
  });
});
