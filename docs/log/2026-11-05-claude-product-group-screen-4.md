# 2026-11-05 22:33 PKT · Claude · Fable 5.1 · branch claude/product-group-screen · TASK
**Task:** product-group screen, continued by the completion session, and the picture step of the end-to-end check (goal plan verification; audit H5, FLOW-01, AUTH-08; areas: .github/workflows/ci.yml office browser job, apps/web/e2e-stack/office.spec.ts)
**What / why:** The goal plan's verification asks for a journey in which the manager adds a product with a picture, and a fresh database needs a way to create a product group. This branch already held the product-group controls (built by a parallel session, local only). Main was merged in (PRs 66 to 70); the conflicts were additive (the stack spec and the blocker and assumption tables) and one test's closing brace was restored. Added: the office browser job now starts the storage service (storage-api is no longer excluded; job names unchanged), and the catalogue journey uploads a real one-pixel PNG through the Products page, sees it saved, and sees the picture load through a signed URL and again after a reload. No migration, function, policy or page changed.
**Evidence:** pnpm typecheck: pass. pnpm exec biome check --diagnostic-level=error: no errors. node scripts/activity-log-check.mjs origin/main: OK. Not run: the stack journeys (no Docker on this host; CI only), so the storage service in the stack and the upload have never run; if the bucket or its policies are missing in the CLI stack, the journey will say so in CI.
**Next / needs:** MJ's OK to push and open the pull request.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (product groups stay owner only, A-19)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
