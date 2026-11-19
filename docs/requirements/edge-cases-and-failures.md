# Edge cases and failure scenarios

Derived reference (see [README.md](README.md)). Per-requirement failure behaviour is in each record; this file lists the cross-cutting scenarios and the expected system response, with the requirement or rule that sets it. "Not built" means the expected response is specified but not implemented.

| Scenario | Expected response | Source | State |
|---|---|---|---|
| The same request is sent twice (retry, replay, double tap) | One effect; the second call returns the first result | H-08, NFR-01 | Built for the listed functions (idempotency key); offline replay not wired |
| A client sends a backdated time | Server time is stored; client time kept only as evidence | H-09 | Built |
| An id in a URL or payload is changed to another salon's or rep's | No wider access; refused or empty | SEC-14, master prompt | Built and tested for the portal |
| Anonymous call to an `app` function | Refused before the function body, except the two storefront reads | B-62 | Built; schema move decided (PR 115) |
| Wrong role calls a function | Refused (42501) | H-15, H-16 | Built |
| Office call without MFA (AAL1) | Refused | D-14 | Built |
| Rep on an unapproved or revoked device | Refused | SEC-03 | Built |
| Approval by its own maker | Refused by constraint | H-12 | Built |
| UPDATE or DELETE on an append-only table | Refused for every role | H-06 | Built and swept by a test |
| Insufficient stock for an issue or delivery | Refused; the shortfall recorded as lost demand | CTL-05, DEM-02 | Refusal built; automatic demand capture not built |
| Order over the credit limit | Hard stop; office override with a reason, capped | ORD-02, CTL-08 | Built |
| Rep cash over the intraday cap | New collections refused until handover or deposit | CTL-17 | Built; manager notice not built |
| Handover count disputed | Locked for the owner | CTL-03 | Built |
| Earlier rep day left open | Check-in blocked until the office force-closes it with a reason | PIP-09 | Built |
| Offline item rejected after sync | Shown to the rep with the reason | NFR-01 | Not built (outbox unwired) |
| Network lost mid-submit in the portal | Never a false success; the user retries | ORD-12, J6 | Built (online only) |
| Delivery without the salon's acknowledgement | Invoice insert refused | D-49 | Built |
| Pending salon gets a request or order | Refused | SAL-13 | Built |
| Salon membership revoked | Every portal read returns nothing | SEC-14 | Built |
| Invitation token expired, used or for another email | Refused | SEC-16 | Built |
| Messaging provider down | Receipt delivery logged and retried | CTL-01 | Not built (no provider) |
| Audit chain broken | `control.verify_audit_chain` reports it; nightly mirror is the second copy | SEC-12 | Verification built; mirror not built |
| Vault read by an un-granted manager | Nothing returned; access logged | VLT-04, VLT-06 | Not built (P1-05) |
| Database restore needed | Restore within 4 h, data no older than 24 h | NFR-10, SEC-10 | Not built |
| Lost or stolen rep phone | Office revokes the device; cached data encrypted | SEC-04, P1-09 store | Revocation built; encrypted store built, unused |
| Supplier term pasted into code, docs or a commit | CI blocks it (Appendix C rule 5, owner terms) | H-01, B-15(a) | Built; the owner-term secret is empty (B-15(a)) |
