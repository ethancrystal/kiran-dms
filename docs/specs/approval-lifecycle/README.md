# Approval lifecycle: TLA+ spec of RFC #4

A model of the design in https://github.com/ethancrystal/kiran-dms/issues/4:
request → decide → authorize, single use. Each RPC is one atomic step.

**Status: parsed and model-checked** with TLA+ tools v1.7.4 (`tla2tools.jar` sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`) on 2026-10-28 (ACTIVITY L-0109). Every result below is a real TLC run. The spec was written in one session (L-0104 to L-0107) and checked in another, which reconstructed it byte for byte from the first session's transcript. `ApprovalLifecycle.tla` and the six `.cfg` files are unchanged from what that session wrote. `Witness.tla` and `run-all.sh` were added by the checking session.

## Files and results

| File | Purpose | Expected | TLC result |
|---|---|---|---|
| `ApprovalLifecycle.tla` | The spec | — | SANY: parsed, no errors |
| `ApprovalLifecycle.cfg` | The RFC as proposed, one owner account | No violation | Running when this was committed (L-0109); result in a later entry |
| `TwoOwners.cfg` | Same model with two owner accounts (OQ-03) | No violation | Not yet run (starts after the one-owner run) |
| `OpenQ5.cfg` | Open question 5: is the checker still active when the approval is used? | `Q5_CheckerActiveAtUse` violated | **Violated**, 5-state trace as predicted |
| `MutantNoRecheck.cfg` | Route not re-checked at use | `S4_CheckerLevelAtUse` violated | **Violated**, 5-state trace as predicted |
| `MutantNoCoverage.cfg` | Coverage check removed | `S3_GatedActionCovered` violated | **Violated**, 4-state trace as predicted |
| `MutantReuse.cfg` | Single-use index removed | `S2_SingleUse` violated | **Violated**, 5-state trace as predicted |
| `Witness.tla` | Reachability witnesses and the RFC-wording check (see below) | — | See below |
| `run-all.sh` | Runs everything above | — | — |

Each mutant breaks exactly the property its check exists for, and each counterexample is the hand-traced one listed under "Expected counterexamples" below, step for step. So none of S2, S3 or S4 is vacuous.

## How to run

```bash
# tla2tools.jar from https://github.com/tlaplus/tlaplus/releases (v1.7.4 or later)
./run-all.sh path/to/tla2tools.jar --quick   # parse, mutants, OpenQ5, witnesses: seconds
./run-all.sh path/to/tla2tools.jar           # also the two clean runs: long: the one-owner run had passed 11.7M distinct states at depth 10 after 10 minutes on 3 workers, still growing
```

Or one config at a time:

```bash
java -cp tla2tools.jar tla2sany.SANY ApprovalLifecycle.tla          # parse only
java -cp tla2tools.jar tlc2.TLC -workers auto -config ApprovalLifecycle.cfg ApprovalLifecycle.tla
```

## Reachability witnesses (`Witness.tla`)

A clean run proves little if the model never reaches the states an invariant talks about. Each witness below claims "this never happens", run with the constants of `ApprovalLifecycle.cfg`. All of them are **violated**, so the main model does reach each scenario.

| Witness | Scenario reached | Shortest trace (actions) |
|---|---|---|
| `W1_WriteOffUsed` | a write-off is approved and used | Request, Decide, Authorize |
| `W2_NoCheckerUse` | a credit override under the cap is recorded with no approval (route `none`) | Authorize |
| `W3_OwnerDiscountUsed` | a discount above the threshold is used under an owner approval | Request, Decide, Authorize |
| `W4_Rejected` | a request is rejected | Request, Decide |
| `W5_Cancelled` | a request is cancelled by its maker | Request, Cancel |
| `W6_TwoUses` | the `UsesBound` limit of 2 uses is reached | Authorize, Authorize |
| `W7_ManagerCheckedUsed` | a manager-checked approval is used | Request, Decide, Authorize |
| `W9_OffboardedMaker` | a pending request whose maker was offboarded | Request, Offboard |
| `A1_NeverEscalate` (action property) | `Escalate` fires: requested at manager level with threshold 2, threshold lowered to 1, level raised to owner | Request, ChangeThreshold, Escalate |

Not shown by a witness: an escalated request that is then approved and used. A state predicate cannot tell an escalated request from one requested at owner level without extra history in the model. Two attempts (dropped) were satisfied by the second kind. Escalate firing (A1) and owner-level pending requests being approved and used (W3) are both shown, and TLC explores every reachable state, so the path is covered by the clean run, but no single trace exhibits it.

## Where the spec differs from RFC #4

Found by reading the spec against the RFC text. Neither makes the design unsafe, but a clean run does not confirm the RFC as literally written.

1. **Use-time level check.** The RFC says: "the decided level must still be at least" the route recomputed at use. The spec's `ApprovalOK` and `S4_CheckerLevelAtUse` compare the **checker's role** with that route instead. `R1_DecidedLevelAtUse` in `Witness.tla` states the RFC wording, and TLC finds it **violated** by the main model in 5 states: threshold 2, the rep requests a discount of 2 (manager level), `own1` approves, the threshold is lowered to 1, and the approval is used where the route is now owner. The spec allows that use; the RFC wording refuses it. The RFC rule is the stricter one and implies S4, since `CanCheck` makes a checker's role at least the decided level. Which rule the implementation should follow is a choice for the RFC (the spec's rule lets an owner's approval of a manager-level request survive a lowered threshold).
2. **Allowed consumer.** The RFC's `authorize_action` checks "the allowed consumer". The spec lets any consumer use an approval of the right kind and subject.

## Property table

| ID | Property | Type | TLA+ | Status |
|---|---|---|---|---|
| TypeOK | Variables stay in their domains | Type | `TypeOK` | Clean run pending |
| S1 | The maker is never the checker (SEC-11, H-12) | Safety | `S1_MakerNeChecker` | Clean run pending |
| S2 | Each approval authorizes at most one action | Safety | `S2_SingleUse` | Clean run pending; broken by `MutantReuse` |
| S3 | Every gated action has an approval that is approved, of the same kind, for the same subject, and covers the server-computed amount | Safety | `S3_GatedActionCovered` | Clean run pending; broken by `MutantNoCoverage` |
| S4 | The checker's role is at least the route computed **when the approval is used** | Safety | `S4_CheckerLevelAtUse` | Clean run pending; broken by `MutantNoRecheck`. Weaker than the RFC wording (see above) |
| S5 | A write-off is always checked by an owner | Safety | `S5_WriteOffOwnerChecked` | Clean run pending |
| S6 | Only office users check; reps never do | Safety | `S6_OnlyOfficeChecks` | Clean run pending |
| S7 | One authorized action per (kind, consumer), so a replay doesn't add a second | Safety | `S7_OneActionPerConsumer` | Clean run pending |
| S8 | Reps request only the kinds they are allowed | Safety | `S8_RepKinds` | Clean run pending |
| S9 | A request has a checker exactly when it is approved or rejected | Structural | `S9_DecidedHasChecker` | Clean run pending |
| G1 | With one owner account, an owner-made write-off is never approved (open question 2) | Safety, documents a gap | `G1_OwnerWriteOffStuck` | Clean run pending; expected to hold |
| Q5 | The checker is still active when the approval is used (open question 5) | Safety, **not promised by the RFC** | `Q5_CheckerActiveAtUse` | **Violated** (`OpenQ5`): `mgr1` approves, is offboarded, the rep uses the approval |
| P1 | A decided request never changes | Action | `P1_DecidedImmutable` | Clean run pending |
| P2 | `authorized_action` is append-only | Action | `P2_UsesAppendOnly` | Clean run pending |
| P3 | The checker level only moves toward owner | Action | `P3_LevelOnlyRises` | Clean run pending |
| L* | Liveness ("a request is eventually decided") | Liveness | — | **Not stated on purpose.** Doc 13 §1 says approvals may wait for the owner indefinitely, so no fairness is assumed. |

## Model checking configuration

- **Constants:**
  - `Reps = {rep1}`, `Managers = {mgr1, mgr2}`, `Owners = {own1}` (or `{own1, own2}`);
  - `Requests = {r1, r2}`, `Subjects = {s1, s2}`, `Consumers = {c1, c2}`;
  - `MaxAmount = 2`, `Thresholds = {1, 2}`.
- **State constraint:** `UsesBound`, at most 2 recorded uses. That is enough for each mutant's counterexample: reuse needs 2, and the others need 1.
- **Symmetry:** the reps, managers, requests, subjects and consumers can be swapped for one another. This is sound because only safety properties are checked.
- **Deadlock checking is off.** Once everything is decided and used, the only remaining steps are threshold changes, which is expected.
- **Size:** larger than the original guess of 10^5 to 10^7 distinct states after symmetry: the one-owner run passed 11.7M distinct states (depth 10, 5.9M queued) after 10 minutes and was still running; the main cost is the subsets of `uses`. If it runs too long, use `Consumers = {c1}` for every config except `MutantReuse`, or `Subjects = {s1}` (that loses the cross-subject check).

### Expected counterexamples (traced by hand, all confirmed by TLC)

- **MutantNoRecheck:**
  1. The threshold is 2. The rep requests a discount of 2, so a manager is needed, and `mgr1` approves.
  2. The owner lowers the threshold to 1.
  3. The approval is used for an amount of 2. The route is now owner, but the checker was a manager.
- **MutantNoCoverage:** the rep requests a discount of 1, `own1` approves, and the approval is used for 2.
- **MutantReuse:** one approved request is used by consumer `c1` and then by consumer `c2`.
- **OpenQ5:** `mgr1` approves, `mgr1` is offboarded, and the rep then uses the approval.

## Assumptions

- **Each RPC is atomic and serializable.** The real functions are single SECURITY DEFINER transactions with `FOR UPDATE` on the request and unique indexes on `authorized_action`. The model's interleaving stands in for "two concurrent uses: one wins". It does not model what happens inside a transaction under READ COMMITTED. That depends on the lock and the index existing, which the RFC's concurrency test has to show.
- **The facts are true.** The `amount` passed to `Authorize` is what the server computed. The amount in a request is whatever the maker claims, so under-reporting is modelled.
- **`app.assert_actor_ready` holds** (role, AAL2 and device). It is reduced to `active[u]`; device binding and MFA are not modelled.
- **The owner changes thresholds.** `ChangeThreshold` stands for `owner_set_config` and keeps values inside the fixed set `Thresholds`. Changing the real values needs MJ (H-26).
- **Who may use an approval** (open question 3) is modelled permissively: the maker or anyone in the office.

## Limits

- **Three kinds stand in for the twelve.** `discount`, `write_off` and `credit_override` represent "base level with an owner threshold", "always owner" and "no checker below the cap". The other kinds, including the receivable write-off rule and restructure's excluded checker, are not modelled.
- **Coverage is reduced to a single `amount <= approved`.** The RFC's eq/max/min spec over several keys, and the per-order discount aggregation that stops a discount being split across lines, are not modelled. A per-line attack would need order and line subjects.
- **Not modelled:**
  - expiry (open question 1, deliberately absent);
  - the audit hash chain;
  - RLS;
  - error codes (`42501`/`55000`/`23505`): a refused call is simply a disabled action;
  - the PWA outbox: an offline replay is a stutter step.
- **Bounded check only.** A clean run covers 1 rep, 2 managers, 1–2 owners, 2 requests, 2 subjects, 2 consumers, amounts 1..2 and at most 2 uses. It says nothing about larger configurations; more confidence would need larger bounds, or a TLAPS proof of S2–S4, which hold inductively.
- **A clean TLC run checks the design, not the SQL.** The RFC's boundary tests in `supabase/tests/` are still what proves the implementation matches the model.
