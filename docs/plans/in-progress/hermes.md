# Hermes handoff: Kiran DMS, the next fifteen tasks

Written 2026-11-06 against `origin/main` at `b29733b` (PR 78 merged). This file is a work order for an
agent that implements and does not plan. Follow it literally. Where it says STOP, stop that task, write
a BLOCKER entry in `docs/log/`, and go to the next task. Do not fill a gap with your own rule.

This file ranks below `CLAUDE.md`, `docs/ACTIVITY.md` and `docs/16-project-completion-goal.md`. If it
disagrees with them, they win and that is a STOP.

Every code fact below was read from the repository on the date above. Line numbers drift: before each
edit, open the file and find the quoted text. If the quoted text is not there, STOP.

## Part 1. Rules for every task

### 1.1 Before the first task (once per session)

0. Pull request 79 must be merged to `main` first: this file and the `docs/plans/` folders exist only
   there, and every task branches from `origin/main`. Run `gh pr view 79 --json state`. If it is not
   `MERGED`, STOP everything and tell MJ.
1. Read `CLAUDE.md`, then `docs/ACTIVITY.md` in full, then the 20 newest files in `docs/log/` (sort by
   name; never read `docs/log/archive.md`).
2. Run `git fetch origin` and `gh pr list --state open`. If an open pull request touches a file named
   in your task, STOP that task.
3. Never work on `main`. Never touch the folders under `.claude/worktrees/` that you did not create.
   Two of them hold other sessions' work:
   - `claude/m7-suspended-cash` (PR 78, migration `20261106020000`): merged to `main` on 2026-11-06.
   - `claude/inactive-sku-names` (not pushed, migration `20261106010000`): REP-14 in progress. Its version
     sorts before `20261106020000`, which is already applied to the Kiran project; that is its owner's to fix.
4. This machine has a global `DATABASE_URL` that points at a hosted project. Never read it, never pass
   it to a command. The database tests use their own embedded Postgres.
5. This machine has no Docker. The office browser journeys (`apps/web/e2e-stack/`) run only in CI. Say
   so in your log entry; never write that they passed locally.

### 1.2 The loop for each task

1. `git switch -c <branch named in the task> origin/main`
2. `pnpm install` (only if `node_modules` is missing), then `pnpm agent:preflight`. It must print
   `PREFLIGHT OK`. Anything else is a STOP.
3. Create the log entry `docs/log/2026-11-06-<branch with slashes as hyphens>.md` (use the real date if
   it is no longer 6 November). Copy the shape of `docs/log/2026-11-06-claude-list-caps.md`: one
   heading line, `**Task:**`, `**What / why:**`, `**Evidence:**`, `**Next / needs:**`, then the security
   checklist. No second heading, no blockquote, no `---` line, no angle bracket, ampersand or backslash.
4. Make exactly the edits the task lists. Nothing else: no refactor, no rename, no formatting of
   untouched lines.
5. Run the checks the task lists. Paste the real pass and fail counts into `**Evidence:**`.
6. Run `pnpm typecheck`, `pnpm lint` and `pnpm activity:check`. All three must pass.
7. Commit with the message the task gives. Stage only the files the task names (never `git add -A`).
8. `git push -u origin <branch>` and open a pull request with `gh pr create`. The pull request is your
   claim. Do not merge it. MJ merges, or tells an agent to, one pull request at a time.
9. Watch CI with `gh pr checks <number>`. A red check is yours to fix on the same branch. Never skip,
   delete or loosen a test to get green (H-23).

### 1.3 Things you never do

- Never edit a migration file that is already on `main`. Every database change is a new file.
- Never apply a migration to any hosted project. Never edit `scripts/apply-kiran-migrations.mjs`, except in H14.
- Never add a table, a column, a role, a permission, a status value or a business rule that a task
  does not spell out.
- Never change an existing test's expectation unless the task names that exact line.
- Never mark a board row `VERIFIED`. Leave `docs/ACTIVITY.md` section 12 alone unless a task says so.

### 1.4 Commands

| Purpose | Command |
|---|---|
| One or more database test files | `pnpm db:test <name> <name>` (for example `pnpm db:test audit-fixes`) |
| Guard files to run after any migration | `pnpm db:test verifier-attacks schema-hygiene rls-matrix` |
| Types | `pnpm typecheck` |
| Lint and format check | `pnpm lint` (`pnpm format` writes fixes) |
| Log rules | `pnpm activity:check` |
| Browser tests with no backend | `pnpm -C apps/web test:e2e` |

Run database test files a few at a time, never the whole suite at once: this machine is short of
memory. If `pnpm -C apps/web test:e2e` fails with "Failed to type check" on a file under `.next/dev`,
delete the folder `apps/web/.next/dev` and run it again.

### 1.5 Migration file rules

- Name: `supabase/migrations/<version>_<slug>.sql`, with the version each task gives. Versions
  `20261106010000` and `20261106020000` are taken by the two branches in 1.1.
- Start with a comment header in the style of `20261105230000_audit_fixes.sql` lines 1 to 12: the
  title line, the requirement IDs, and what changes.
- A function replaced with the same arguments and the same return type uses `create or replace
  function` and writes no `revoke` or `grant`: the existing ones stand.
- Every function keeps `set search_path = ''`.
- None of the tasks below adds a function name, so the allowlist in
  `supabase/tests/verifier-attacks.test.ts` does not change. If you find yourself adding a name, STOP.

## Part 2. The tasks, in order

Do them in this order. Tasks H1, H2 and H5 edit `supabase/tests/audit-fixes.test.ts`, so each must be
merged, or at least rebased onto the one before, before the next starts. H12 needs H11 merged. H15 comes
last. No task edits the plan list; H15 does that once, so the pull requests do not conflict.

### H1. A superseded refusal no longer shows on rejected goods

Plan item: C2 "Stale refused request shown on pending stock". Branch `claude/stale-refused-request`.
Migration `20261106030000_pending_stock_newest_request.sql`. No page changes.

The defect: `app.office_pending_stock` picks the newest request among those it may show, so when a
newer request was withdrawn or used, an older refused one comes back with its refusal reason.

Steps.

1. Open `supabase/migrations/20261105230000_audit_fixes.sql`. Find `create function
   app.office_pending_stock()` (near line 597). Copy the whole function, from that line through its
   closing `end $$;`, into the new migration. Change `create function` to `create or replace
   function`. Do not copy the `drop function` line above it.
2. In the copy, replace the block that starts `left join lateral (` and ends `limit 1) req on true`
   with exactly this:

```sql
  left join lateral (
    select n.id, n.status, n.maker_id, n.checker_role_required, n.decision_reason, n.qty
    from (
      select a.id, a.status, a.maker_id, a.checker_role_required, a.decision_reason,
             case when jsonb_typeof(a.payload -> 'qty_delta') = 'number' and (a.payload ->> 'qty_delta') ~ '^-?[0-9]{1,6}$'
                  then -((a.payload ->> 'qty_delta')::integer) end qty
      from control.approval_request a
      where a.kind = 'adjustment' and a.subject_type = 'stock_location' and a.subject_id = q.pending_location_id
        and a.payload ->> 'submission_id' = q.submission_id::text and a.payload ->> 'sku_id' = q.sku_id::text
      order by a.created_at desc, a.id
      limit 1) n
    where n.status in ('pending', 'rejected')
       or (n.status = 'approved' and not exists (select 1 from public.stock_movement m where m.approval_id = n.id))
  ) req on true
```

3. Leave every other line of the function as it was.
4. Test. In `supabase/tests/audit-fixes.test.ts`, directly after the test whose name starts `M8: the
   missing-goods row shows` (near line 491), add:

```ts
  it("a refused request stops showing once a newer request for the same goods was withdrawn", async () => {
    const ocid = id(),
      scid = id(),
      rcid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const shown = (m: string) =>
      mark(
        m,
        `(select jsonb_build_object('id', request_id, 'status', request_status, 'why', request_decision_reason)
                  from app.office_pending_stock() where submission_id = ${sub}) as x`,
        "manager",
      );
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, 'Counter', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), 'salon refused the goods');`],
      // An older request, already refused. Planted with an earlier created_at: two requests made through
      // the API inside one transaction would share now(), and the newest could not be told apart.
      [
        "postgres",
        `insert into control.approval_request (client_id, kind, subject_type, subject_id, payload, maker_id,
           checker_role_required, checker_id, status, reason, decision_reason, created_at, decided_at)
         values (gen_random_uuid(), 'adjustment', 'stock_location', ${PENDING_A},
           jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), '${fx.manager.id}',
           'manager', '${fx.owner.id}', 'rejected', 'two units missing', 'recount first please',
           now() - interval '1 hour', now() - interval '50 minutes');`,
      ],
      shown("before"),
      [
        "manager",
        `select app.request_approval('${rcid}', 'adjustment', 'stock_location', ${PENDING_A},
         jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), 'two units missing again');`,
      ],
      [
        "manager",
        `select app.cancel_approval((select id from control.approval_request where client_id = '${rcid}'), 'made by mistake');`,
      ],
      shown("after"),
    ]);
    expect(r.before[0].x).toMatchObject({ status: "rejected", why: "recount first please" });
    expect(r.after[0].x).toEqual({ id: null, status: null, why: null });
  });
```

5. If the planted `insert` is refused by a constraint or trigger, STOP and put the exact message in a
   BLOCKER. Do not loosen the constraint.
6. Checks: `pnpm db:test audit-fixes delivery-approval`, then the three guard files.
7. Commit: `A superseded refusal no longer shows on rejected goods (plan C2)`.

Done means: the new test passes, the M8 test still passes, the guard files pass.

### H2. Timelines show delivery submissions, decisions, signatures and payment reversals

Plan item: C2 "Timelines cover delivery submissions, commission, signatures, reversals, settlements".
Branch `claude/timeline-coverage`. Migration `20261106040000_timeline_coverage.sql`. No page changes:
`apps/web/components/timeline.tsx` prints any label.

Scope ruling, already made, do not widen it. Four tables are added: `delivery_submission`,
`delivery_submission_decision`, `delivery_signature`, `payment_reversal`. Left out on purpose, because
they name neither a salon nor an order or hold pictures: `commission_payment`, `rep_commission_rate`,
`handover_settlement`, `pending_stock_resolution`, `delivery_signature_use`,
`delivery_signature_image`, `delivery_signature_access`, and every stock, location, vault and investor
table. Say this in the log entry under "Deliberately not done".

Steps.

1. Open `supabase/migrations/20261105160000_rep_readonly_timelines.sql`. Copy these three functions
   whole into the new migration, each as `create or replace function`: `app.timeline_label` (near line
   163), `app.office_salon_timeline` (near 225), `app.office_order_timeline` (near 256). Do not copy
   `app.timeline_actor`, the indexes or the privilege lines.
2. In `app.timeline_label`, in the first `case p_table`, add these lines directly above `else
   'changed'`:

```sql
      when 'public.delivery_submission'          then 'delivery submitted'
      when 'public.delivery_submission_decision' then 'delivery ' || coalesce(p_after ->> 'outcome', 'decided')
      when 'public.delivery_signature'           then 'receipt acknowledgement'
      when 'public.payment_reversal'             then 'payment reversed'
```

3. In the second `case p_table` of the same function, add directly above the final `else null`:

```sql
      when 'public.delivery_signature'           then p_after ->> 'outcome'
```

4. In `app.office_salon_timeline`:
   - Between the `language plpgsql ...` line and `begin`, add:

```sql
declare
  v_submission text[];
```

   - Directly after the `unknown salon` check's `end if;`, add:

```sql
  select coalesce(array_agg(s.id::text), '{}') into v_submission
  from public.delivery_submission s where s.salon_id = p_salon_id;
```

   - In the list that starts `x.table_name in ('public.salon_contact',` change the end of the list
     from `'public.payment')` to `'public.payment', 'public.delivery_submission',
     'public.delivery_signature')`.
   - Directly above `order by x.seq desc`, add:

```sql
       or (x.table_name = 'public.delivery_submission_decision'
           and coalesce(x.after ->> 'submission_id', x.before ->> 'submission_id') = any (v_submission))
       or (x.table_name = 'public.payment_reversal'
           and exists (select 1 from public.payment p where p.salon_id = p_salon_id
                       and p.id::text = coalesce(x.after ->> 'payment_id', x.before ->> 'payment_id')))
```

5. In `app.office_order_timeline`:
   - In the `declare` block add two lines: `v_submission text[];` and `v_payment text[];`.
   - Directly after the statement that fills `v_installment`, add:

```sql
  select coalesce(array_agg(s.id::text), '{}') into v_submission
  from public.delivery_submission s where s.order_id = p_order_id;
  select coalesce(array_agg(distinct a.payment_id::text), '{}') into v_payment
  from public.payment_allocation a where a.installment_id::text = any (v_installment);
```

   - In the list `('public.sales_order_line', 'public.credit_event', 'public.delivery',
     'public.invoice', 'public.order_intake_card_close')` add `'public.delivery_submission',
     'public.delivery_signature'` before the closing bracket.
   - Directly above `order by x.seq desc`, add:

```sql
       or (x.table_name = 'public.delivery_submission_decision'
           and coalesce(x.after ->> 'submission_id', x.before ->> 'submission_id') = any (v_submission))
       or (x.table_name = 'public.payment_reversal'
           and coalesce(x.after ->> 'payment_id', x.before ->> 'payment_id') = any (v_payment))
```

6. Test. The fixtures a delivery needs (warehouse, bag, stock, credit) exist only in
   `supabase/tests/audit-fixes.test.ts`, so the test goes there, not in
   `rep-readonly-timelines.test.ts`. Say so in the log entry. Add a new `describe` block directly
   above the line `describe("the new office functions refuse AAL1 office sessions and a salon login
   (42501)"`:

```ts
describe("timelines cover delivery submissions, decisions, signatures and payment reversals (plan C2)", () => {
  const KEYS = ["action", "actor_kind", "actor_name", "detail", "entity", "entity_id", "occurred_at", "seq"];
  const timeline = (m: string, fn: "salon" | "order", arg: string): Step =>
    mark(
      m,
      `(select coalesce(jsonb_agg(to_jsonb(t) order by t.seq), '[]'::jsonb) from app.office_${fn}_timeline(${arg}) t) as x`,
      "manager",
    );
  const actionsOf = (rows: unknown) => (rows as Row[]).map((e) => String(e.action));

  it("a delivered order shows the submission, the acknowledgement and the approval; the salon also shows a reversal", async () => {
    const ocid = id(),
      pcid = id();
    const r = await tx([
      order(ocid),
      deliver(ocid),
      repCash(pcid, UNIT),
      [
        "manager",
        `select app.office_reverse_payment(gen_random_uuid(), (select id from public.payment where client_id = '${pcid}'), '[Test] tl-secret reversal');`,
      ],
      timeline("o", "order", orderOf(ocid)),
      timeline("s", "salon", `'${SALON}'`),
    ]);
    const orderRows = r.o[0].x as Row[];
    const salonRows = r.s[0].x as Row[];
    expect(actionsOf(orderRows)).toEqual(
      expect.arrayContaining(["delivery submitted", "receipt acknowledgement", "delivery approved"]),
    );
    expect(actionsOf(salonRows)).toEqual(
      expect.arrayContaining(["delivery submitted", "receipt acknowledgement", "delivery approved", "payment reversed"]),
    );
    expect(orderRows.find((e) => e.action === "receipt acknowledgement")?.detail).toBe("signed");
    for (const e of [...orderRows, ...salonRows]) expect(Object.keys(e).sort()).toEqual(KEYS);
    const all = JSON.stringify([...orderRows, ...salonRows]);
    for (const s of ["tl-secret", "Ayesha Khan", "token", "hash", "purpose"]) expect(all, s).not.toContain(s);
    for (const e of [...orderRows, ...salonRows]) {
      expect(String(e.entity), String(e.entity)).not.toMatch(/commission|handover|stock|signature_(use|image|access)/);
    }
  });

  it("a rejected delivery reads delivery rejected on the order, without the office's reason", async () => {
    const ocid = id(),
      scid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, '[Test] Tl Receiver', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), '[Test] tl-secret reject');`],
      timeline("o", "order", orderOf(ocid)),
    ]);
    const rows = r.o[0].x as Row[];
    expect(actionsOf(rows)).toEqual(expect.arrayContaining(["delivery submitted", "delivery rejected"]));
    const all = JSON.stringify(rows);
    for (const s of ["tl-secret", "Tl Receiver"]) expect(all, s).not.toContain(s);
  });
});
```

7. Before running, open the existing test near line 622 (`a rep's cash collection reversed by the
   manager`) and compare its `app.office_reverse_payment(...)` call with the one above. If the
   argument order differs, use the existing test's order.
8. Checks: `pnpm db:test audit-fixes rep-readonly-timelines`, then the three guard files. The leak
   test in `rep-readonly-timelines.test.ts` must pass unchanged.
9. Docs, same pull request (H-25). In `docs/06-security-plan.md` find the sentence near line 62 that
   lists the tables the timelines read; add the four table names to that list. Do the same in
   `SPEC.md` near line 134 if it lists tables. Change no other sentence.
10. Commit: `Timelines show delivery submissions, decisions, signatures and payment reversals (plan C2)`.

### H3. Reordering a route still works after one stop's salon moved away

Plan item: C3 REP-13. Branch `claude/reorder-hidden-stop`. Migration
`20261106050000_reorder_visible_stops.sql`. No page changes.

The defect: `app.my_route` hides a stop whose salon the rep no longer holds, but
`app.rep_reorder_route` counts every stop, so the rep's list is always one short and every reorder is
refused with `name every stop of the route exactly once`.

Ruling, already made: hidden stops are renumbered after the visible ones, in their old order. The
function returns the number of visible stops.

Steps.

1. The new migration holds exactly this function (it replaces the one in
   `20261028080000_routes.sql` near line 266; same arguments, same return type):

```sql
create or replace function app.rep_reorder_route(p_day date, p_stop_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  r      public.route;
  v_n    integer;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps reorder their own route'); end if;
  if p_day is null or p_day < app.karachi_today() then
    perform app.raise_denied('a past route is final');
  end if;
  select * into r from public.route where rep_id = auth.uid() and day = p_day for update;
  if r.id is null then raise exception using errcode = '22023', message = 'no route for that day'; end if;
  -- Only the stops the rep can still see (app.my_route's rule): a stop whose salon moved away is hidden
  -- from the rep, so it cannot be named.
  select count(*) into v_n from public.route_stop s
   where s.route_id = r.id and app.rep_holds_salon(auth.uid(), s.salon_id);
  if p_stop_ids is null or cardinality(p_stop_ids) <> v_n
     or (select count(distinct x) from unnest(p_stop_ids) x where x is not null) <> v_n
     or exists (select 1 from unnest(p_stop_ids) x
                where not exists (select 1 from public.route_stop s
                                  where s.id = x and s.route_id = r.id
                                    and app.rep_holds_salon(auth.uid(), s.salon_id))) then
    raise exception using errcode = '22023', message = 'name every stop of the route exactly once';
  end if;
  perform app.set_purpose('route reordered by the rep');
  -- Named stops first, in the order given; hidden stops after them, in their old order.
  update public.route_stop s set sequence = o.n
  from (select t.id, row_number() over (order by (x.ord is null), x.ord, t.sequence)::integer as n
          from public.route_stop t
          left join unnest(p_stop_ids) with ordinality as x(id, ord) on x.id = t.id
         where t.route_id = r.id) o
  where s.id = o.id and s.sequence <> o.n;
  return v_n;
end $$;
```

2. Before saving, open `supabase/migrations/20261028080000_routes.sql` near line 266 and confirm the
   first thirteen lines of the body (down to the `no route for that day` line) match the block above
   word for word. If they do not, STOP.
3. Test. In `supabase/tests/routes.test.ts`, directly above the test named `a stop outside the rep's
   current territories disappears from its route at once`, add:

```ts
  it("the rep can still reorder after one stop's salon is given to another rep (REP-13)", async () => {
    const r = await run(
      "postgres",
      `${asUser(fx.manager, "aal2")}
       select app.office_assign_salon_rep(gen_random_uuid(), '${S3}', '${fx.repB.id}', null);
       ${asUser(fx.repA, "aal1")}
       select 'n' as mark, app.rep_reorder_route(${TODAY}, (select array_agg(stop_id order by sequence desc) from app.my_route())) as n;
       select 'visible' as mark, salon_id, sequence from app.my_route() order by sequence;
       reset role;
       select 'hidden' as mark, st.salon_id, st.sequence from public.route_stop st join public.route ro on ro.id = st.route_id
        where ro.rep_id = '${fx.repA.id}' and ro.day = ${TODAY} and st.salon_id = '${S3}';`,
    );
    // Every statement returns a result, so the three reads are found by their mark, not by position.
    const marked = (m: string) => (r as unknown as Multi).find((x) => x.rows?.[0]?.mark === m)?.rows ?? [];
    expect(marked("n")[0].n).toBe(2);
    expect(marked("visible").map((v) => [v.salon_id, v.sequence])).toEqual([
      [S2, 1],
      [S1, 2],
    ]);
    expect(marked("hidden").map((v) => [v.salon_id, v.sequence])).toEqual([[S3, 3]]);
  });
```

4. The test relies on the route left by the earlier tests in the file (three stops for rep A in the
   order S3, S1, S2, as the test `the rep reorders its route` leaves them). If the `visible` rows come
   back in another order because an earlier test changed, do not edit the earlier test: STOP. If `app.office_assign_salon_rep` is refused with `this salon is pending: decide it first`, add
   `await approveSalon(S3);` as the first line of the test and import `approveSalon` from
   `./helpers/db`. If it is refused for any other reason, STOP.
5. Checks: `pnpm db:test routes`, then the three guard files. Every existing test in `routes.test.ts`
   must pass unchanged.
6. Commit: `A rep can reorder a route after one stop's salon moved away (REP-13)`.

### H4. The one refusal a rep sees with a paisa figure now says rupees

Plan item: C3 REP-16. Branch `claude/rupees-in-refusals`. Migration
`20261106060000_payment_refusal_rupees.sql`. No page changes.

Scope ruling, already made: only the message that reaches a rep's screen changes, `the payment is more
than the salon owes (N paisa)`. Eight office-only messages also quote paisa; they wait for MJ (Part 3).
The format copies the two rupee messages already in `20261105230000_audit_fixes.sql`.

Steps.

1. Run `grep -n "function app.record_payment" supabase/migrations/*.sql`. The last file listed must be
   `20261103210000_office_cash.sql`. If a later file appears, STOP.
2. Copy the whole function from `20261103210000_office_cash.sql`, from the line `create or replace
   function app.record_payment(` (near line 22) through its closing `end $$;` (near line 139), into
   the new migration. Change nothing in the copy except the one line in step 3.
3. Replace the line

```sql
    raise exception using errcode = '23514', message = format('the payment is more than the salon owes (%s paisa)', v_owed);
```

   with

```sql
    raise exception using errcode = '23514',
      message = format('the payment is more than the salon owes (Rs %s)', to_char(v_owed / 100.0, 'FM999,999,990.00'));
```

4. Test. In `supabase/tests/payments.test.ts` near line 388, replace the one line

```ts
      `more than the salon owes (${UNIT} paisa)`,
```

   with

```ts
      `more than the salon owes (Rs ${(UNIT / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
```

   This is the only existing expectation you may change in this task, because the message it pins is
   the thing being changed. Say so in the log entry.
5. Checks: `pnpm db:test payments office-cash audit-fixes`, then the three guard files.
6. Commit: `The payment refusal a rep sees quotes rupees, not paisa (REP-16)`.

### H5. Prove that an invited rep's password token reads no profile or device row

Plan item: C2 "AUTH-05 residual". Branch `claude/auth05-proof`. No migration, no page change: a test
only.

Reading the code, the gap the plan describes is already closed: both policies call `app.self_ok()`,
which fails for an invited rep's password token since `20261105230000_audit_fixes.sql`. Nothing pins
that. This task adds the proof.

Steps.

1. In `supabase/tests/audit-fixes.test.ts`, inside the test whose name starts `after redemption, a
   password token reads no session` (near line 228), directly after the line

```ts
    expect(await pw("select * from app.my_handovers();")).toBe(DENIED);
```

   add:

```ts
    // The residual of AUTH-05: the same password token reads neither its profile row nor its device rows.
    expect((await pwRows("select count(*)::int as n from public.user_profile;"))[0].n).toBe(0);
    expect((await pwRows("select count(*)::int as n from public.device;"))[0].n).toBe(0);
```

2. Run `pnpm db:test audit-fixes`.
3. If both new lines pass: in the log entry, state that the earlier note in `2026-11-05-claude-p1-30-audit-fixes` was
   inaccurate and that no policy changed.
4. If either new line fails: STOP. Do not change a policy. Remove nothing. Write a BLOCKER with the
   count the test returned. Commit the test as `it.fails` only if `docs/ACTIVITY.md` section 14 shows
   that pattern is still in use for defect checks; otherwise leave the branch unpushed and report.
5. Commit: `Test: an invited rep's password token reads no profile or device row (AUTH-05)`.

### H6. The Park button shows only where the database allows parking

Plan item: C3 REP-12. Branch `claude/park-where-allowed`. Page only.

`app.rep_park_salon` parks only a salon whose stage is prospect, visited or trial. The page offers Park
for every stage except parked, so the rep gets a refusal.

Steps.

1. Open `apps/web/app/app/salons/[id]/page.tsx`.
2. Near the other top-level constants of the file, add:

```ts
// app.rep_park_salon: the only stages a rep may park.
const PARKABLE = ["prospect", "visited", "trial"];
```

3. Find the line `{salon.stage !== "parked" && (` (near line 221, directly above the section with
   `aria-labelledby="park-h"`). Replace it with `{PARKABLE.includes(salon.stage) && (`.
4. Change nothing else. No test file changes: no browser test mentions Park.
5. Checks: `pnpm typecheck`, `pnpm lint`.
6. Log entry: say the page was not exercised in a browser (it needs a signed-in rep).
7. Commit: `Rep salon page offers Park only for stages the database allows (REP-12)`.

### H7. Editing a request that holds a product no longer sold

Plan item: C4 AUTH-13. Branch `claude/request-removed-product`. Pages only.

The database rightly refuses an edit that holds an inactive product, but the message names no line and
the form cannot show the line, so the salon cannot get out. The fix drops such lines from the edit form
and says which were dropped.

Steps, salon page.

1. Open `apps/web/app/salon/page.tsx`. Find the component `EditRequest` (near line 486) and inside it
   the line

```ts
  const [picks, setPicks] = useState<PickLine[]>(() => request.lines.map((l) => newPick(l.sku_id, String(l.qty))));
```

2. Replace that one line with:

```ts
  // A line whose product is no longer in the catalogue cannot be saved (the database refuses the whole
  // edit), so it is left out of the form and named below.
  const sellable = new Set(catalogue.map((i) => i.sku_id));
  const gone = request.lines.filter((l) => !sellable.has(l.sku_id));
  const [picks, setPicks] = useState<PickLine[]>(() => {
    const kept = request.lines.filter((l) => sellable.has(l.sku_id));
    return kept.length > 0 ? kept.map((l) => newPick(l.sku_id, String(l.qty))) : [newPick()];
  });
```

3. In the JSX that `EditRequest` returns, directly above the `LinePicker` element, add:

```tsx
      {gone.length > 0 && (
        <p className="muted" data-testid="removed-lines">
          No longer sold and taken off this request: {gone.map((l) => `${l.code} · ${l.product_name} ${l.variant}`).join(", ")}.
          Save to keep the rest, or cancel the request.
        </p>
      )}
```

4. If `catalogue` is not a prop or variable in scope inside `EditRequest`, STOP (the `LinePicker`
   options line `options={catalogue.map((i) => ({ id: i.sku_id, label: itemText(i) }))}` shows that it
   is).

Steps, rep card page.

5. Open `apps/web/app/app/cards/page.tsx`. Find (near line 184)

```ts
    card.lines.length > 0 ? card.lines.map((l) => newPick(l.sku_id, String(l.qty))) : [newPick()],
```

   This sits inside a `useState` initialiser of the card edit form. Find the variable that holds the
   product options in that component (the value passed as `options` to `LinePicker`; it is filled from
   `repProductOptions()` and each option has an `id`).
6. If those options are loaded after the first render (they are fetched in an effect), do not filter in
   the initialiser. Leave the rep card page unchanged, and say in the log entry: "rep card edit not
   changed: its options load after the form is seeded; needs a small design, not done". Do not invent
   one.

Finish.

7. Checks: `pnpm typecheck`, `pnpm lint`.
8. Database test, to pin the rule the page now works around. In
   `supabase/tests/requests-portal.test.ts` find the test near line 476 about an edit making a new
   version, and read how it calls the local helpers `submit` and `edit`. Add one new test after it
   that: submits a request with two products as salon A, deactivates the second SKU as the manager
   with the same function the file's `beforeAll` used to create it (pass `active` false), expects
   `edit` with both lines to return `22023`, and expects `edit` with only the first line to succeed.
   If the file has no helper that deactivates a SKU and you cannot find the upsert call in its
   `beforeAll`, skip this step and say so in the log entry.
9. Commit: `Salon request edit drops and names lines whose product is no longer sold (AUTH-13)`.

### H8. The salon list filters by approval and shows why a salon was rejected

Plan item: C4 L8. Branch `claude/salon-list-approval`. Page only: the office already may read
`public.salon_approval_decision` under its select policy.

Steps.

1. Open `apps/web/app/office/(shell)/salons/page.tsx`.
2. Next to the existing `stage` state, add:

```ts
  const [approval, setApproval] = useState("");
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
```

3. Inside `load`, directly after the line `if (stage) q = q.eq("stage", stage);`, add:

```ts
      if (approval) q = q.eq("approval_status", approval);
```

4. Still inside `load`, directly after the line `setList(r.slice(0, PAGE));`, add:

```ts
      const rejected = r
        .slice(0, PAGE)
        .filter((s) => s.approval_status === "rejected")
        .map((s) => s.id);
      const why =
        rejected.length === 0
          ? []
          : await rows<{ salon_id: string; reason: string | null }>(
              db().from("salon_approval_decision").select("salon_id, reason").eq("decision", "rejected").in("salon_id", rejected),
            );
      setReasons(new Map(why.map((w) => [w.salon_id, w.reason ?? ""])));
```

5. Change the dependency array of the `useCallback` that wraps `load` from `[page, stage, term]` to
   `[page, stage, term, approval]`.
6. In the filter form, directly after the Stage `label` and `select`, add:

```tsx
          <label htmlFor="salon-approval">Approval</label>
          <select
            id="salon-approval"
            value={approval}
            onChange={(e) => {
              setApproval(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
```

   Match the markup of the Stage control beside it (if Stage wraps its `select` in a `div` or uses a
   class, do the same). If the page has no `setPage`, STOP.
7. In the table cell that renders the badge (find `{s.approval_status !== "approved" && (`), directly
   after that badge block and inside the same cell, add:

```tsx
                  {s.approval_status === "rejected" && reasons.get(s.id) && (
                    <div className="muted" data-testid="rejection-reason">
                      Rejected: {reasons.get(s.id)}
                    </div>
                  )}
```

8. Checks: `pnpm typecheck`, `pnpm lint`.
9. Log entry: the page was not exercised in a browser locally; the existing journeys do not use the
   new control.
10. Commit: `Salon list filters by approval and shows the rejection reason (L8)`.

### H9. The Office cash note says what the figure really holds

Plan item: C4 L6. Branch `claude/office-cash-note`. Page only, one sentence.

Steps.

1. Open `apps/web/app/office/(shell)/handovers/page.tsx`. Find the text

```
(handed over and acknowledged or settled, and cash the office collected itself; bank deposits are not built yet)
```

2. Replace it with:

```
(cash reps handed over, once acknowledged or settled, plus cash the office collected itself, less cash payments that were reversed. Bank deposits are not recorded here yet, so this figure does not go down when cash is banked.)
```

3. Do not touch the element with `data-testid="office-cash"`.
4. Checks: `pnpm typecheck`, `pnpm lint`.
5. Commit: `Office cash note names everything the figure holds (L6)`.

### H10. The rep can reach salons past the first 50 when adding a route stop

Plan item: C3 REP-07. Branch `claude/route-picker-more`. Page only.

Adding any salon the rep holds already works. What is left: the picker holds only the first 50 salons
by name and offers no way to load more.

Steps.

1. Open `apps/web/app/app/route/page.tsx`. The picker's salons are the state `const [salons, setSalons]
   = useState<Mine[]>([]);` (near line 43), filled in the load function from `const [r, u, s] = await
   Promise.all([... salonPage()])` (near line 66).
2. Directly under the `salons` state line add:

```ts
  const [more, setMore] = useState(false);
```

3. In the load function, on the line directly after the existing `setSalons(...)` call, add
   `setMore(s.length === SALON_PAGE);`.
4. Add this function next to the other handlers of the component. If `pnpm typecheck` rejects the
   argument of `salonPage` or the appended rows, read how the load function converts `s` before
   `setSalons` and convert `next` the same way; if that is not a one-line change, STOP.

```ts
  const showMore = async () => {
    const next = await salonPage(salons[salons.length - 1]);
    setSalons((s) => [...s, ...next]);
    setMore(next.length === SALON_PAGE);
  };
```

5. Find the line

```tsx
              {salons.length === SALON_PAGE && <p className="muted">Showing your first {SALON_PAGE} salons by name.</p>}
```

   and replace it with:

```tsx
              {more && (
                <button type="button" onClick={() => void showMore()}>
                  Show more salons
                </button>
              )}
```

6. Compare with `apps/web/app/app/salons/page.tsx` lines 10 to 21, which pages the same read the same
   way. If that page handles a failed load with a shared error state, wrap `showMore` the same way.
7. Checks: `pnpm typecheck`, `pnpm lint`.
8. Log entry: paging is not browser-tested (no fixture holds more than 50 salons).
9. Commit: `Route stop picker can load salons past the first 50 (REP-07)`.

### H11. A receipt says when its payment was reversed

Plan item: C5 "Rep and salon receipt views" (first part). Branch `claude/receipt-shows-reversal`. Pages
only. `app.receipt_document` already returns `reversed` with `reversed_at` and `reason` when a payment was
reversed, but `ReceiptDocument` drops it, so a reversed receipt prints as if it were good. This task also
moves the receipt body into one shared component, which H12 reuses.

Steps.

1. In `apps/web/lib/documents.ts`, inside `export type ReceiptDocument = {`, directly under the line
   `  remaining: Array<{ invoice_number: string; seq: number; of: number; due_on: string; remaining_paisa: number }>;`
   and its neighbour `  notices: Notice[];`, add after `notices`:

```ts
  reversed?: { reversed_at: string; reason: string };
```

2. Open `apps/web/app/office/(shell)/receipts/[id]/page.tsx`. Create
   `apps/web/components/receipt-sheet.tsx` starting with these lines:

```tsx
import { fullDay, METHOD_TEXT, ONLY_VALID_PROOF, type ReceiptDocument } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

// One receipt's printable body (F6; CTL-01), shared by the office and rep pages. Everything printed is
// app.receipt_document's: nothing is added up here. The office sees why a payment was reversed; a rep sees
// only that it was, as app.my_collections tells it.
export function ReceiptSheet({ doc: d, showReversalReason = false }: { doc: ReceiptDocument; showReversalReason?: boolean }) {
  return (
    <>
```

3. Move into that component, between `<>` and the closing below, every line of the office page from
   `<div className="doc-head">` down through the closing of `{d.notices.map(...)}`, unchanged. Directly
   above the moved `<dl>`, add:

```tsx
      {d.reversed && (
        <p className="error" data-testid="doc-reversed">
          This payment was reversed on {when(d.reversed.reversed_at)} and no longer counts as paid.
          {showReversalReason && ` Reason: ${d.reversed.reason}`}
        </p>
      )}
```

4. Close the component with:

```tsx
    </>
  );
}
```

5. In the office page, where the moved lines were, put `<ReceiptSheet doc={d} showReversalReason />`. Add
   `import { ReceiptSheet } from "@/components/receipt-sheet";`. Reduce the documents import to
   `import { isUuid, type ReceiptDocument } from "@/lib/documents";`. Delete the imports of `rupees` and
   `when`. Keep the `<article>` and the back link and Print button, which stay on the page.
6. Test. In `apps/web/e2e-stack/p130-screens.spec.ts`, in the test whose name starts `payment reversal:
   the manager cannot reverse`, find where it opens the receipt after the owner reverses. Add there:
   `await expect(page.getByTestId("doc-reversed")).toContainText("was reversed");` using that test's
   real page variable. If the test does not open `/office/receipts/...`, skip this step and say so in the
   log entry. Do not add a navigation.
7. Checks: `pnpm typecheck`, `pnpm lint`, `pnpm db:test audit-fixes`. The test near `-> 'reversed' ->>
   'reason'` already pins what the function returns.
8. Commit: `A receipt says when its payment was reversed; one shared receipt sheet`.

### H12. A rep can open the receipt of a payment they just recorded

Plan item: C5 "Rep and salon receipt views" (second part). Branch `claude/rep-receipt-view`. Page only,
after H11 is merged. `app.receipt_document` already serves the rep who recorded the payment, on their
approved phone. The link is added only on the "Payment recorded" message, where the id is already in hand.
A link from the rep's list of collections needs a new field on `app.my_collections` and a receipt view for
the salon needs a new function; both stay in Part 3.

Steps.

1. Create `apps/web/app/app/receipts/[id]/page.tsx` with exactly:

```tsx
"use client";
import Link from "next/link";
import { use } from "react";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { useRpcRead } from "@/components/use-rpc-read";
import { isUuid, type ReceiptDocument } from "@/lib/documents";

// A receipt for the rep who recorded the payment. app.receipt_document answers null both for an id that
// does not exist and for a caller it refuses, so the page has one message for both.
export default function RepReceiptView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return isUuid(id) ? <Receipt id={id} /> : <NotFound />;
}

const NotFound = () => (
  <>
    <h1>Receipt</h1>
    <p className="error" role="alert">
      This receipt does not exist, or it is not one you recorded.
    </p>
    <Link href="/app/handovers">Back to your payments</Link>
  </>
);

function Receipt({ id }: { id: string }) {
  const read = useRpcRead<ReceiptDocument | null>("receipt_document", { p_receipt_id: id }, id);
  if (read.loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (read.error)
    return (
      <p className="error" role="alert">
        {read.error}
      </p>
    );
  if (!read.data) return <NotFound />;
  return (
    <article>
      <p className="row no-print">
        <Link href="/app/handovers">Back to your payments</Link>
      </p>
      <ReceiptSheet doc={read.data} />
    </article>
  );
}
```

2. In `apps/web/components/money-section.tsx`, replace

```tsx
          {mode === "office" && receipt.id ? (
            <Link href={`/office/receipts/${receipt.id}`}>{receipt.number}</Link>
          ) : (
```

   with

```tsx
          {receipt.id ? (
            <Link href={`${mode === "office" ? "/office/receipts" : "/app/receipts"}/${receipt.id}`}>{receipt.number}</Link>
          ) : (
```

3. Checks: `pnpm typecheck`, `pnpm lint`, `pnpm -C apps/web test:e2e`.
4. Log entry: the page was not exercised in a browser locally; say that the database side is covered by
   `supabase/tests/payments.test.ts` and `rep-detail-documents.test.ts`, which you did not change.
5. Commit: `A rep can open the receipt of a payment they just recorded`.

### H13. The salon picker on the invitation form says when it is at its cap

Plan item: C4 L7 (the note only; the search stays in Part 3). Branch `claude/invite-picker-note`. Page
only. The list reads at most 500 salons and says nothing when a salon further down cannot be picked. The
order form already says so; this copies its wording, not `ListCapNote`, whose words are about newest rows
and do not fit a list sorted by name.

Steps.

1. In `apps/web/app/office/(shell)/people/page.tsx`, find the `</select>` that closes the element with
   `id="invite-salon"`. Directly after it, inside the same fragment, add:

```tsx
              {salons.length === LIST_LIMIT && (
                <p className="muted">
                  Showing the first {LIST_LIMIT} salons by name. A salon further down the list cannot be picked here yet.
                </p>
              )}
```

2. Checks: `pnpm typecheck`, `pnpm lint`.
3. Log entry: not exercised in a browser (no fixture holds 500 salons); `LIST_LIMIT` also caps the areas
   list, which is not touched.
4. Commit: `The invitation form's salon picker says when it is at its cap (L7, the note)`.

### H14. The migration script recognises what the Kiran project already holds

Plan item: none; found on 2026-11-06 (decision file `2026-11-06-mj-apply-inactive-rep-cash`). Branch
`claude/apply-script-parts`. This task alone may edit `scripts/apply-kiran-migrations.mjs` (rule 1.3 is
lifted for this file only). You still never run it against a hosted project, and never with `--dry-run`
against one either: MJ does that.

The defects: the script has a fixed list of files, and it matches by exact name, so it reports
`audit_fixes` as pending although the project holds it in three parts, and it would miss every newer file.

Steps.

1. Replace the block from `const FILES = [` through its closing `];` with:

```js
// Every migration from the first after office_orders_cards on, in file-name order.
const FIRST_PENDING = "20261105100000";
const FILES = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql") && f >= FIRST_PENDING)
  .map((f) => f.slice(0, -".sql".length))
  .sort();
// Recorded under other names on the project: audit_fixes went in as three parts on 2026-11-05.
const RECORDED_AS = { audit_fixes: ["audit_fixes_part1_of_3", "audit_fixes_part2_of_3", "audit_fixes_part3_of_3"] };
const isRecorded = (names, name) => (RECORDED_AS[name] ?? [name]).every((n) => names.includes(n));
```

2. Change `import { readFileSync } from "node:fs";` to `import { readdirSync, readFileSync } from "node:fs";`.
3. Replace the line

```js
  const todo = FILES.filter((f) => !names.includes(f.slice(f.indexOf("_") + 1)));
```

   with

```js
  const todo = FILES.filter((f) => !isRecorded(names, f.slice(f.indexOf("_") + 1)));
```

4. Replace the block starting `if (todo.length === FILES.length && (rows.length !== EXPECTED_COUNT` through
   its closing `}` with:

```js
  if (!names.includes(LAST_APPLIED)) {
    throw new Error(`Expected ${LAST_APPLIED} to be applied already. Stop and tell Claude what differs.`);
  }
```

   Delete the now unused line `const EXPECTED_COUNT = 25;`.
5. In the comment at the top of the file, replace `Applies the 13 pending migrations (after
   office_orders_cards)` with `Applies the migrations not yet recorded (after office_orders_cards)`.
6. Checks: `node --check scripts/apply-kiran-migrations.mjs`, and run
   `node scripts/apply-kiran-migrations.mjs` with `KIRAN_DB_URL` unset: it must stop with
   `Set KIRAN_DB_URL`. Then `pnpm lint`.
7. Log entry: say the script was not run against any database, and that MJ's next dry run is its first
   real check.
8. Commit: `Migration script reads the folder and knows audit_fixes went in as three parts`.

### H15. Bring the records up to date

Plan item: C8. Branch `claude/records-after-hermes`. Documents only. Do this last, after H1 to H14 are
merged. For this task alone, rule 1.3's "leave section 12 alone" is lifted for the rows named here.

Steps, board.

1. For each row below, in the Status cell of `docs/ACTIVITY.md` section 12, first run `gh pr checks <PR>`.
   If a required check is not a pass, leave that row and name it in the log entry.
2. Otherwise replace the words from `implemented on branch` through `an independent check` with
   `merged in pull request <PR> at <merge>; required checks green; awaiting an independent check`. Keep the
   words `IN PROGRESS (` before and everything after them. Do not write the word VERIFIED anywhere in a cell:
   the log check refuses it, and this task verifies nothing. Plain ASCII only, no backticks.

| Row | PR | Merge |
|---|---|---|
| P1-18 | 56 | e7209f4 |
| P1-19 | 57 | 72cc365 |
| P1-20 | 58 | 903cd29 |
| P1-21 | 59 | e703fe3 |
| P1-22 | 61 | fae0690 |
| P1-23 | 63 | d92191d |
| P1-24 | 64 | 348d0e1 |
| P1-25 | 65 | 50e7162 |
| P1-26 | 66 | 609f317 |
| P1-28 | 68 | 518716e |
| P1-31 | 68 | 518716e |
| P1-29 | 69 | a83b095 |
| P1-30 | 70 | 67671ec |

3. In the P1-19 cell, also replace everything from `picture upload not exercised` through `not merged and
   not run` with `product group screen and the picture upload check merged in pull request 71`.
4. In the P1-24 cell, replace `the end-to-end journey of the completion design waits for slices 4 to 6,
   listed in docs/plans/implemented/2026-11-05-final-review-checklist.md` with `the end-to-end journey was
   built in P1-25`.

Steps, plan list. In `docs/plans/in-progress/2026-11-05-remaining-implementation.md`:

5. On the line for each merged item, append the note in this table. Leave out any item whose pull request
   did not merge.

| Line starts | Append |
|---|---|
| `\| Stale refused request shown on pending stock` (first cell) | ` (done, H1)` |
| `\| Timelines cover delivery submissions` (first cell) | ` (delivery submissions, decisions, signatures and reversals done, H2; commission and handover settlements name no salon or order and wait for MJ)` |
| `\| AUTH-05 residual` (first cell) | ` (already closed by app.self_ok; proved by a test, H5)` |
| `- REP-07:` | ` (Adding any reachable salon was already built in P1-29; paging past 50 done, H10.)` |
| `- REP-12, REP-13:` | ` (Done, H6 and H3.)` |
| `- REP-16, L3:` | ` (The rep-facing payment refusal done, H4; the office-only messages wait for MJ.)` |
| `- AUTH-13, AUTH-14:` | ` (AUTH-13 done for the salon page, H7.)` |
| `- L6, L7, L8:` | ` (L6 done, H9; L8 done, H8; for L7 only the note on the invitation form, H13.)` |
| `\| Rep and salon receipt views; a payments list page` (first cell) | ` (the rep's view and the reversal on a receipt done, H11 and H12)` |

Steps, plan folder.

6. Run `git mv docs/plans/in-progress/hermes.md docs/plans/implemented/hermes.md`. In `docs/plans/README.md`
   change the two paths and the row for `hermes.md` to say all fifteen tasks are done, naming any that
   stopped. Search `docs/plans` for `in-progress/hermes.md` and fix what you find.
7. Checks: `pnpm activity:check`.
8. Commit: `Records: board rows name their merged pull requests; plan list and folders up to date`.

## Part 3. Not for Hermes: these wait for MJ

Do not start any of these. Each needs a business decision that the documents do not make.

| Item | Why it waits | What exists today |
|---|---|---|
| Unreconciled handover blocks the next check-in (PIP-09) | "Unreconciled" is not defined; doc 08 says no exceptions, doc 03 says a manager override; no table can record an override | Check-in is blocked only by an earlier day left open |
| Close a part-delivered order (M6) | B-45 | No way to close it |
| Receivables by rep follow direct assignment (M4) | A-14, confirmed as territory | Territory |
| REP-05, blind stock issue count | The real fix narrows the `stock_issue_select` policy; MJ to approve, and to say whether a disputed issue stays hidden | The office's quantities reach the rep's browser |
| REP-19, mock-location flag | A browser cannot read the phone's mock-location setting; the source must be decided | All three forms send false |
| REP-16, office-only messages in paisa | Eight messages; scope and format | Quoted in paisa |
| AUTH-12, office user on the rep page gets a phone row | The audit left it to MJ; refusing every office session breaks an existing test | A row is created |
| AUTH-14, request lines keep the price | Is it the price of the order made from the request, or the price when the request was sent? The second needs a price on a table whose rule is "never a price" | Today's price is shown |
| L7, searching salon pickers past 500 | Type-to-filter above the list, or a combobox; one threshold or three | Capped at 500, 500 and 200 |
| Salon receipt view, a payments list, a receipt link in the rep's list | What "payments list" means; may a salon see the bank reference and the reversal reason; the link needs a new field on `app.my_collections` | Office view, and the rep's view from H12 |
| Salon statement | A period statement or a printable current position; SAL-12 is Phase 1, CTL-10 is Phase 2 | Balance, invoices and payments on the portal |
| Correction from a count variance | Which difference to post, one correction per line, who checks | Counts are stored; no link to an adjustment |
| Timelines for commission and handover settlements | Neither names a salon or an order; they would need a rep timeline | Not shown |
| P1-03, P1-05, P1-08, P1-09, P1-10, P1-12, P1-15, P1-17 | No implementation plan is written for any of them | Not started |

## Part 4. When all fifteen are done

Write one final log line in the entry of H15 listing the fifteen branches and pull request numbers,
which checks were green on each, and what was not run locally (every stack journey). Then stop. Do not
pick a task from Part 3 or from the plan file on your own.
