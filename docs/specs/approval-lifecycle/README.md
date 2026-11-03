# Approval lifecycle: TLA+ spec of RFC #4

A model of the design in https://github.com/ethancrystal/kiran-dms/issues/4: request → decide → authorize, single use. Each RPC is one atomic step. It models a **proposal**: none of the RFC's objects (`authorize_action`, `control.authorized_action`, `approval_spec`) exist in the database yet.

**Status.** The spec parses (SANY). Every result below is a real TLC run (TLA+ tools v1.7.4, TLC 2.19); the table says which session ran it and where it is logged. Checking is **bounded and design-level**: it says nothing about larger configurations or about the SQL. See "Limits and known gaps".

## Provenance

- Written by cloud session 01Y3chVt and checked by cloud session 01Y3chVr on the unmerged branch `claude/architecture-rfc` (commits `ea027b2`, `0c72b1e`, `003727e`, `8f0d329`). Their log entries there are numbered L-0104 to L-0109 and clash with this log, so they are not cited as IDs here.
- Brought into this log by ACTIVITY **L-0328** (files exactly as in `8f0d329`). An independent four-lens review followed (**L-0329**), and the changes it led to are in **L-0330**: `S10` and `S13`, `SymmAll`, `W10`, the configs `TwoOwnersSmall` and `TwoOwnersMid`, a runner that can fail, and `fetch-tools.sh`. The new invariants do not change which behaviours the model allows.
- The one-owner clean run and the Mutant and Witness results below predate `S10` and `S13`, which were added afterwards (see the table).

## Files and results

| File | Purpose | Expected | Result and who ran it |
|---|---|---|---|
| `ApprovalLifecycle.tla` | The model | SANY parses | Parsed (01Y3chVr; again in L-0328 and L-0331) |
| `ApprovalLifecycle.cfg` | The checker-role use-time rule (S4), one owner account | No violation | **No error**: 20,713,620 distinct states, depth 13, 27 min on 3 workers (01Y3chVr, before `S10`/`S13`; **not re-run here**: it needs a bigger host than this one) |
| `TwoOwners.cfg` | Same, two owner accounts (OQ-03), with owner symmetry | No violation | **Not completed.** The same config without owner symmetry was stopped after 2 h 06 min on a 2-vCPU host at depth 8 with 21,325,079 distinct states (123,527,144 generated, 15.5 million queued) and **no violation**; a second owner multiplies the state space by an estimated 7 to 13 times (about 3 to 6 times with symmetry), so a full run needs a bigger host (L-0329) |
| `TwoOwnersMid.cfg` | Two owners, two managers, one subject, one consumer | No violation | **No error**: 4,406,964 distinct states, depth 12, 11 min on a 2-vCPU host; includes S10 and S13 (L-0331) |
| `TwoOwnersSmall.cfg` | Two owners, one manager, one subject, one consumer | No violation | **No error**: 1,188,224 distinct states, depth 11, 2.5 min; includes S10 and S13 (L-0331) |
| `OpenQ5.cfg` | Open question 5: checker offboarded before use | `Q5_CheckerActiveAtUse` violated | **Violated** in 5 states (01Y3chVr; L-0328; L-0331) |
| `MutantNoRecheck.cfg` | Route not re-checked at use | `S4_CheckerLevelAtUse` violated | **Violated** in 5 states (same) |
| `MutantNoCoverage.cfg` | Coverage check removed | `S3_GatedActionCovered` violated | **Violated** in 4 states (same) |
| `MutantReuse.cfg` | Single-use index removed | `S2_SingleUse` violated | **Violated** in 5 states (same) |
| `Witness.tla` | Reachability witnesses and the RFC-wording check | Each violated | All violated as expected (L-0328; L-0331). `W10` is new |
| `run-all.sh` | Runs everything, compares with the expected result, **exits 1 on any mismatch** | — | See "How to run" |
| `fetch-tools.sh` | Downloads the pinned `tla2tools.jar` and verifies size and sha256 | — | — |

Each mutant cfg lists one invariant, so TLC stops at that violation. The reviewers re-ran each mutant with every other property switched on (on tiny constants) and the target was the only property that broke, but no committed run shows it: the claim "each mutant breaks exactly one property" rests on that scratch check. `OpenQ5` is not a mutant: it is the spec as written, checked for a property the RFC does not promise.

Counts at the moment of a violation (for example 21,611 distinct states for `MutantReuse` in L-0328 against 14,476 in the earlier session) differ between runs with parallel workers, so only the violated property and the trace length are reproducible.

## How to run

Needs Java and `bash` (tested with OpenJDK 25; TLA+ tools v1.7.4 document Java 11 or later). On Windows, use WSL; a `/mnt/c/...` checkout works because `run-all.sh` copies the files to a temp directory.

```bash
./fetch-tools.sh ./tla-tools            # downloads tla2tools.jar v1.7.4 into a new directory, checks sha256
./run-all.sh ./tla-tools/tla2tools.jar --quick    # parse, mutants, OpenQ5, witnesses (about 2 min)
./run-all.sh ./tla-tools/tla2tools.jar --medium   # plus TwoOwnersSmall and TwoOwnersMid (tens of minutes)
./run-all.sh ./tla-tools/tla2tools.jar --full     # plus the two clean runs (hours; needs a large host)
```

Pinned jar: `tla2tools.jar` v1.7.4, 2,274,532 bytes, sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. `TLC_WORKERS` and `TLC_JAVA_OPTS` (for example `-Xmx1500m`) tune the runs. On a 2-vCPU, 3.9 GB WSL host with the machine short of memory, `--medium` is the practical top, and the full configs would take many hours.

One config at a time:

```bash
java -cp tla2tools.jar tla2sany.SANY ApprovalLifecycle.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config ApprovalLifecycle.cfg ApprovalLifecycle.tla
```

## Reachability witnesses (`Witness.tla`)

A clean run proves little if the model never reaches the states an invariant talks about. Each witness claims "this never happens"; **TLC reporting it violated shows the scenario is reachable**. The run uses the constants of `ApprovalLifecycle.cfg` (`W10` those of `TwoOwners.cfg`).

| Witness | Scenario reached | Shortest trace |
|---|---|---|
| `W1_WriteOffUsed` | a write-off is approved and used | Request, Decide, Authorize |
| `W2_NoCheckerUse` | a credit override under the cap is recorded with no approval (route `none`) | Authorize |
| `W3_OwnerDiscountUsed` | a discount above the threshold is used under an owner approval | Request, Decide, Authorize |
| `W4_Rejected` | a request is rejected | Request, Decide |
| `W5_Cancelled` | a request is cancelled by its maker | Request, Cancel |
| `W6_TwoUses` | the `UsesBound` limit of 2 uses is reached | Authorize, Authorize |
| `W7_ManagerCheckedUsed` | a manager-checked approval is used | Request, Decide, Authorize |
| `W9_OffboardedMaker` | a pending request whose maker was offboarded | Request, Offboard |
| `W10_OwnerWriteOffApproved` | **two owners:** an owner-made write-off is approved by the other owner (3 states) | Request, Decide |
| `A1_NeverEscalate` (action property) | `Escalate` fires | Request, ChangeThreshold, Escalate |
| `R1_DecidedLevelAtUse` | the RFC wording of the use-time rule (see next section) | 5 states |

There is no `W8`. An escalated request that is then approved and used cannot be shown by a plain state predicate. A witness-only history variable in a wrapper module does show it in 6 states (found in the review, L-0329); it is not committed because the wrapper re-lists `Next` by hand and would drift.

## Where the spec differs from RFC #4

Neither point makes the design unsafe. Because the RFC wording is a restriction of what the model allows, S1 to S10, S13 and P1 to P3 carry over to it; what a clean run does not show is that the stricter rule is usable.

1. **Use-time level check.** The RFC says "the decided level must still be at least" the route recomputed at use. The spec's `ApprovalOK` and `S4_CheckerLevelAtUse` compare the **checker's role** with that route instead. `R1_DecidedLevelAtUse` states the RFC wording and TLC finds it violated in 5 states (threshold 2, the rep requests a discount of 2 at manager level, `own1` approves, the threshold is lowered to 1, the approval is used where the route is now owner). `R1` implies `S4` at decision time and only while roles do not change. **Main already chose the spec's reading** for one kind: `app.office_post_adjustment` in `20261028050000_inventory.sql` reads the checker's current role and status and never a stored decided level. So "a choice for the RFC" now also means "whether to change merged code".
2. **Allowed consumer and actor.** The spec reads "allowed consumer" as the consumer row only. Who may use an approval is modelled permissively (the maker or anyone in the office) on the approval path, and on the `none` route any active user can record a use. No property reads the actor, so the model cannot tell any answer to open question 3 apart.
3. **Replay with different facts.** The RFC says a second call for the same (kind, consumer) "returns the original row". It never says the new facts, subject or approval are compared first. The model removes the case (the step is disabled), which is exact for an identical replay only. In the RFC's own usage the consumer is the order, so a second pricing call for one order is such a replay. The review reproduced uncovered writes under both readings of the RFC (3 and 5 states) and a stuck second approval under the checks-first reading (7 states) on a scratch extension. This needs an RFC decision.

## Property table

| ID | Property | Type | TLA+ | Status |
|---|---|---|---|---|
| TypeOK | Variables stay in their domains | Type | `TypeOK` | Holds in every completed clean run |
| S1 | The request's maker is never its checker (SEC-11, H-12) | Safety | `S1_MakerNeChecker` | Holds. Doc 03 SEC-11 says the user who *initiates* the action can never approve; the model lets the checker run the action |
| S2 | Each approval authorizes at most one action | Safety | `S2_SingleUse` | Holds; broken by `MutantReuse` |
| S3 | Every gated action has an approved request of the same kind and subject whose amount covers the server-computed amount | Safety | `S3_GatedActionCovered` | Holds; broken by `MutantNoCoverage` |
| S4 | The checker's role is at least the route computed when the approval is used | Safety | `S4_CheckerLevelAtUse` | Holds; broken by `MutantNoRecheck`; weaker than the RFC wording (see above) |
| S5 | Every **used** write-off was approved by an owner | Safety | `S5_WriteOffOwnerChecked` | Holds. The docs disagree on whether a manager may approve small write-offs (docs 03, 06, 10 against doc 13 and D-08); the spec takes the strict reading |
| S6 | Only office users check; reps never do | Safety | `S6_OnlyOfficeChecks` | Holds |
| S7 | One authorized action per (kind, consumer): an identical replay adds no second row | Safety | `S7_OneActionPerConsumer` | Holds |
| S8 | Reps request only discounts (the real list also has return_accept and payment_reversal, not modelled) | Safety | `S8_RepKinds` | Holds |
| S9 | A request has a checker exactly when it is approved or rejected | Structural | `S9_DecidedHasChecker` | Holds |
| S10 | The decider's role is at least the level decided at (**new, L-0330**) | Safety | `S10_DeciderRankCoversLevel` | Holds on the runs listed above that include it. Closes a gap: with the rank clause of `CanCheck` deleted, S1 to S9 and P1 to P3 all stayed clean |
| S13 | Every write-off decided is decided by an owner (**new, L-0330**) | Safety | `S13_WriteOffDecidedByOwner` | Same |
| G1 | With one owner account, an owner-made write-off is never approved (OQ-02) | Safety, documents a gap | `G1_OwnerWriteOffStuck` | Holds with one owner. Vacuous with two (it needs `W10` to see the change) |
| Q5 | The checker is still active when the approval is used (OQ-05) | Safety, **not promised by the RFC** | `Q5_CheckerActiveAtUse` | **Violated** (`OpenQ5`). Main's `office_post_adjustment` never reads the checker's status either |
| P1 | A decided request never changes | Action | `P1_DecidedImmutable` | Holds. The identity of a *pending* request is protected by no property |
| P2 | `authorized_action` is append-only | Action | `P2_UsesAppendOnly` | Holds (structural) |
| P3 | The checker level only moves toward owner | Action | `P3_LevelOnlyRises` | Holds |
| L* | Liveness | Liveness | — | **Not stated.** Doc 13 section 2 says approvals queue when the owner is away for days; leaving liveness out is a modelling choice, not something the document requires |

## Model checking configuration

- **Constants** (`ApprovalLifecycle.cfg`): `Reps = {rep1}`, `Managers = {mgr1, mgr2}`, `Owners = {own1}` (two owners in `TwoOwners*.cfg`), `Requests = {r1, r2}`, `Subjects = {s1, s2}`, `Consumers = {c1, c2}`, `MaxAmount = 2`, `Thresholds = {1, 2}`.
- **State constraint `UsesBound`** (at most 2 recorded uses). TLC still generates a successor with a third use and checks every invariant and action property on it, but does not expand it; states with four or more uses are never generated. The bound loses nothing for the present properties (all are per use or pairwise) and every counterexample here needs 2 uses or fewer. It would be inadequate for a property over three or more uses, such as a per-order discount-splitting cap.
- **Symmetry** (`Symm`; `SymmAll` adds the owners). Sound because every formula quantifies uniformly over these sets, `None` is in none of them, nothing uses `CHOOSE` or orders model values, and the only temporal properties are action properties checked per transition. Merely "only safety properties are checked" is not the whole condition. With one owner `SymmAll` is the identity.
- **Deadlock checking is off.** Once everything is decided and used, the only steps left are threshold changes.
- **Size.** One owner: 20,713,620 distinct states (earlier session). A second owner multiplies the state space; see the table.

### Expected counterexamples (traced by hand, confirmed by TLC)

- **MutantNoRecheck:** threshold 2; the rep requests a discount of 2 (manager level); `mgr1` approves; the owner lowers the threshold to 1; the approval is used for 2. The route is now owner but the checker was a manager.
- **MutantNoCoverage:** the rep requests a discount of 1, `own1` approves, the approval is used for 2.
- **MutantReuse:** one approved request is used by `c1` and then by `c2`.
- **OpenQ5:** `mgr1` approves, `mgr1` is offboarded, the rep then uses the approval.

## Assumptions

- **Each RPC is atomic.** The real functions will be single SECURITY DEFINER transactions with `FOR UPDATE` on the request and a unique index on `authorized_action`. **Today** `request_approval` takes no row lock, `authorized_action` does not exist, the isolation level is the default READ COMMITTED, and no concurrency test exists. The model's interleaving stands in for "two concurrent uses: one wins"; the RFC's concurrency test has to show it.
- **The facts are true.** The `amount` passed to `Authorize` is what the server computed; the amount in a request is what the maker claims, so under-reporting is modelled.
- **`app.assert_actor_ready` holds** (role, AAL2, device). It is reduced to `active[u]`.
- **The owner changes thresholds**, inside the fixed set `Thresholds` (`ChangeThreshold`). A missing or malformed key, which the RFC routes to the owner, is not representable.
- **Offboard never targets an owner.** The SQL only blocks self-targeting (`owner_set_status`), so one owner can suspend another. Right for one owner; for two it hides scenarios such as a second owner being disabled.
- **A refused call is a disabled action.** Error codes (`42501`, `55000`, `23505`) are not modelled. Whether `decide_approval` can return normally while the request stays pending (what `Escalate` assumes) or would raise and roll back the level change is not settled by the RFC.

## Limits and known gaps

- **Three kinds stand in for twelve** (`discount`, `write_off`, `credit_override`). The other kinds, `subject_type`, per-kind maker roles and "a kind with no spec entry is refused" are not modelled. `write_off` merges the stock write-off (maker a manager) and the receivable write-off (maker an owner). `credit_override` follows doc 13 ("no checker below caps"); docs 06 and 09 and the P1-06 code now on main (`app.assert_manager_override_allowed`) describe a hard manager cap with a direct owner override.
- **Coverage is one number**, `amount <= approved`. The RFC's eq/max/min spec over several keys and the per-order discount aggregation are not modelled, and the domain write that follows `authorize_action` is not modelled either, so an uncovered write through the replay path is invisible.
- **Properties the model cannot see** (found in the review, L-0329; formulas exist for all of them, unadded): the freshness guard in `Decide`; the four `active` guards and `Offboard`; the identity of a pending request; whether the maker-only rule in `Cancel` holds; whether a discount ever *needs* an approval (S3 and S4 are relative to the model's own `Route`). The 4 to 5 state mutants that expose each are in the L-0329 record.
- **Not modelled:** expiry (OQ-01); the audit hash chain; RLS and grants; the PWA outbox (an offline replay is a stutter step only for an identical replay); concurrency inside a transaction.
- **Main already overlaps the RFC.** `office_post_adjustment` implements single use (a unique index on `stock_movement.approval_id`), the use-time owner recompute and the checker-role test for kind `adjustment`. If `adjustment` later also goes through `authorize_action`, there would be two single-use registries and S2 would hold per registry only.
- **Small scope:** 1 rep, 1 or 2 managers, 1 or 2 owners, 2 requests, up to 2 subjects and consumers, amounts 1..2, at most 2 uses. More confidence would need larger bounds or a TLAPS proof of S2 to S4.
- **A clean TLC run checks the design, not the SQL.** The RFC's boundary tests in `supabase/tests/` are what will prove the implementation matches. Nothing in CI runs `run-all.sh`.
- **Open questions for MJ** (RFC issue 4 questions 1 to 5, plus the ones the review raised) are collected in ACTIVITY blocker **B-39**.
