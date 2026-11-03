------------------------------ MODULE Witness ------------------------------
(* Reachability witnesses for ApprovalLifecycle, run with the constants of *)
(* ApprovalLifecycle.cfg. Each one claims that a scenario never happens,  *)
(* so TLC reporting it VIOLATED shows the main model reaches the scenario *)
(* and the safety invariants are not passing vacuously there.             *)
(* R1 is different: it states the RFC #4 wording of the use-time check    *)
(* and is expected to be VIOLATED because the spec checks a weaker rule.  *)
EXTENDS ApprovalLifecycle

W1_WriteOffUsed       == ~\E x \in uses : x.kind = "write_off"
W2_NoCheckerUse       == ~\E x \in uses : x.route = "none" /\ x.approval = None
W3_OwnerDiscountUsed  == ~\E x \in uses : x.kind = "discount" /\ x.route = "owner"
W4_Rejected           == ~\E r \in Requests : req[r].status = "rejected"
W5_Cancelled          == ~\E r \in Requests : req[r].status = "cancelled"
W6_TwoUses            == Cardinality(uses) < 2
W7_ManagerCheckedUsed == ~\E x \in uses : x.approval # None /\ req[x.approval].checker \in Managers
W9_OffboardedMaker    == ~\E r \in Requests : req[r].status = "pending" /\ req[r].maker # None
                                              /\ ~active[req[r].maker]

(* Action witness: claims Escalate never fires. *)
A1_NeverEscalate      == [][~\E r \in Requests : Escalate(r)]_vars

(* RFC #4: "the decided level must still be at least" the route at use. *)
R1_DecidedLevelAtUse  == \A x \in uses : x.approval # None => Rank(req[x.approval].level) >= Rank(x.route)

(* Needs two owners (run with TwoOwners.cfg constants): an owner-made write-off is approved by *)
(* the other owner (open question 2). With one owner this is not reachable (G1 holds).        *)
W10_OwnerWriteOffApproved == ~\E r \in Requests : req[r].kind = "write_off" /\ req[r].maker \in Owners
                                                  /\ req[r].status = "approved"
=============================================================================
