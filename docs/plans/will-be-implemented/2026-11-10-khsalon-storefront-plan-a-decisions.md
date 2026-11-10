# khsalon.com storefront, plan A (P1-32): decisions and records

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-32).

**Goal:** the repo says what MJ decided, so later agents are not stopped by H-21, H-22 and D-41.

**Docs only. No code, no migration.**

Tasks
- [ ] `DECISION` log entries recording D-51 to D-61, quoting MJ's words from section 2 exactly, and one `ASSUMPTION` entry for A-23.
- [ ] Add D-51 to D-61 to the decision log in `docs/12-decisions-and-open-questions.md`.
- [ ] Add rows P1-32 to P1-38 to the status board, all NOT STARTED.
- [ ] Add blockers B-54 to B-61, with B-60 already answered by D-61 (check the next free number first; B-53 was the last seen) and assumption A-23.
- [ ] Mark B-10 (real catalogue) as part answered: MJ delivered one bill and two photos.
- [ ] Copy this plan set into `docs/plans/will-be-implemented/` as one file per plan, plus this overview and the agent prompts.
- [ ] Add the shop to `CONTEXT-MAP.md` as an eighth context, "storefront", with its vocabulary: visitor, visit, published, default price, storefront event.

Not in this plan: any change to `docs/16-project-completion-goal.md`. It is MJ's document; propose the wording in the pull request text and let MJ decide.

Done when: `pnpm activity:check` and `pnpm agent:preflight` pass and the pull request is open.
