# 2026-11-09 19:39 PKT · Claude · Sonnet 5.5 · branch claude/salon-self-signup · DECISION
**Task:** Salons may sign up on their own (reverses the invitation-only rule for salons; reps stay invitation-only). Changes SEC-13, SAL-11, doc 06 section 2.1, D-30 and D-39 wording, SPEC.md section 11, and the hosted-project step in docs/runbooks/owner-bootstrap.md.
**What / why:** MJ in chat on 2026-11-09, asked to check every user role after deploying, answered: "No I actually need a signup too so client salons can signup on their own, Sales rep signup is totally on invite base but Client Salon could just go to the site or app anad signup easily". This reverses L-0376 ("a salon gets portal access only by invitation from the office; there is no public sign-up"), which the documents repeat in SEC-13, doc 06 section 2.1 and D-30. Per H-26 and section 1, MJ's current explicit instruction outranks those documents, so this entry records it before any code.
**Two answers MJ gave in the same chat.** Asked "When a salon signs up on its own, what should it become?", MJ chose "New pending salon (Recommended)": the salon can sign in and see that it is waiting, cannot order until the office approves it at /office/salons/approvals, and existing imported salons are not touched. Asked "How should a salon sign in after signing up?", MJ chose "Email + 6-digit code (Recommended)": the same emailed code that invited salons and reps use, no password.
**What stays as it was:** reps are invitation-only (MJ: "Sales rep signup is totally on invite base"). Staff accounts (owner, manager, rep, agent) are never created by self-signup; no user_profile row is ever made from it. One login per salon and one salon per login (L-0382) stays. A salon still cannot order, see prices or see the catalogue until the office approves it (D-35).
**Design note, a difference from the words of the answer:** the answer says a "pending salon". A public.salon row needs a staff creator (created_by is not null and refers to user_profile) and an area (area_id is not null), and a self-signing salon has neither; a pending row would also enter rep territory and route logic. So the build keeps the applicant's details in a signup request, and the office's approval creates the real salon and the login's membership, picking the area and the rep. To the salon the effect is the one MJ chose (it waits, then it is in). This is logged as a DEVIATION in the TASK entry of this pull request.
**Not covered by this entry, still MJ's:** applying the new migration to the Kiran Supabase project (H-19, needs its own DECISION), switching on sign-up in the hosted project's Authentication settings, the Confirm signup email template showing the code (B-47a), and connecting an SMTP provider (a new third party, section 9, H-21). Supabase's built-in email is rate limited, so public sign-up will stall without one.
**Next / needs:** build on this branch and open a draft pull request; MJ approves merging in chat for that pull request.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table added by this entry; the build entry covers it)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no table touched)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no code in this entry)
[x] Audit trigger present; hash chain verifies (H-17) (no table touched)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (a rule is changed on MJ's instruction, none is bypassed)
[x] Docs match code; deviations logged (H-25) (the doc edits follow in the same pull request)
[x] Production touched only with MJ's approval (H-19) (nothing applied anywhere by this entry)
