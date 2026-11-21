## What this PR is

The previous session left the P1-05 vault foundation uncommitted in `.worktrees/vault`. Commit `a6ecdc7` preserves that work verbatim (snapshot); `77b4b32` merges origin/main for a clean base. **This is a DRAFT — a review vehicle and a preservation receipt, not a merge request.** No encryption is implemented this wave, per the C0 work order; the one open question belongs to MJ (B-63, below).

## The snapshot (what the other session built)

- `supabase/migrations/20261121150000_vault_suppliers.sql`: `supplier_vault.supplier` (name, contact, phone, note, status), the append-only `supplier_vault.vault_access_log` (who, when, which function, which row ids, a required purpose, client_id replay protection per H-08), the `vault_api` door (`supplier_list`, `supplier_upsert`, `supplier_grant_set` — SECURITY DEFINER, `search_path = ''`, gated on `app.has_vault_grant()` = active profile + owner or granted manager + AAL2), grants revoked from anon and service_role.
- Schema isolation: `supplier_vault` is not in the PostgREST exposed schemas; RLS enabled and forced with no policies (deny by default).
- Audit: the trigger fires and extends the hash chain (H-17), and `control.audit_row()` redacts `supplier_vault` row images (DA-033) so no vault value reaches `control.audit_event`.
- UI slice: `apps/web/app/office/(shell)/vault/suppliers/page.tsx` + nav wiring; db test file `supabase/tests/vault-suppliers.test.ts`.

## THE QUESTION FOR MJ — B-63: encryption approach for the identity columns

**The gap:** the snapshot stores `name`, `contact_name`, `phone`, `note` as **plain text**. [Doc 07 line 23](../blob/main/docs/07-supplier-confidentiality.md) requires column encryption for identity and cost fields (`*_enc`) using **pgsodium** with the key in Supabase Vault — "so even a database dump or a misconfigured policy yields ciphertext" — and doc 07 §5 test 3 requires a dump without the key to show ciphertext in every `*_enc` column. The access layers above are strong, but a full dump or a leaked backup defeats them all at once; that is the one guarantee line 23 exists for. Doc 07 is a fixed decision MJ owns (H-26), so the agent does not pick.

**(a) DEVIATION — keep plain text + access control.** Change doc 07 (line 23, §5 test 3) in the same PR that lands it, log a DEVIATION. Cheapest; db:test unaffected. Cost: a dump or backup leak shows supplier identities in the clear — the exact threat line 23 names.

**(b) pgcrypto parity.** `pgcrypto` is **present** in the CI embedded Postgres (verified on this host: `@embedded-postgres/windows-x64@17.9.0-beta.17` ships `pgcrypto.control` + `pgcrypto.dll`; CI uses the same npm family on linux-x64 — this PR's db-tests job is the direct CI proof). Columns become bytea `*_enc`; `pgp_sym_encrypt`/`pgp_sym_decrypt` run only inside the `vault_api` functions; the key lives server-side (Supabase Vault / Edge Function secret via a server setting) and never enters the repo. db:test keeps working unchanged. Differences from doc 07's design, stated honestly: no pgsodium key table or derived subkeys, manual key rotation, doc 07 line 23 needs a small pgsodium→pgcrypto amendment (MJ's), and encrypted columns cannot be searched directly (lookups via the functions or hashed companion columns).

**(c) Full pgsodium parity (as doc 07 is written).** Hosted Supabase has pgsodium; the npm embedded Postgres does **not** (no pgsodium file anywhere in the dependency tree — verified). Every db test touching an `*_enc` column would fail or need skipping in CI, and H-23 forbids skipping. Needs a custom CI image or a hosted-only test path (spend + environment decisions above an agent) and delays P1-05.

**Default until MJ answers:** the branch stays as snapshotted (plain text under the controls above); nothing merged or applied anywhere. The BLOCKER entry is `docs/log/2026-11-21-vault-encryption-options-blocker.md` (B-63, also added to ACTIVITY §14 on this branch).

## Evidence (run locally in .worktrees/vault)

- Guards: uncommitted set matched the handoff's expectation; newest file mtimes 08:55–08:58 PKT, ~14 h before the guard ran → cold; snapshot committed and pushed before anything else.
- `pnpm lint` (biome ci): exit 0 — 249 files, 42 warnings / 38 infos, the pre-existing baseline (snapshot files included).
- `pnpm -C apps/web typecheck`: exit 0. `node scripts/agent-preflight.mjs`: OK. `node scripts/activity-log-check.mjs`: OK after this slice's entries.

## Not run (by rule or environment)

- `pnpm db:test` — forbidden on this host per the handoff; with it, the snapshot's own `supabase/tests/vault-suppliers.test.ts` has never been executed by this slice. CI runs it on this PR (that job also decides option (b)'s CI claim on linux-x64).
- The e2e stacks (no Docker). The office browser job is expected red on this base until C0a merges (pre-existing on main, run 44930031088).

## Traceability, risks, rollback

- P1-05 (VLT-01/04/06 foundation, doc 07); H-01/H-05/H-08/H-13/H-17 shape-checked above; board row P1-43 lives on the sheet PR (#135) per the work order; this branch adds only the §14 B-63 row.
- Risks: the plain-text gap itself (that is what B-63 resolves); the snapshot is another session's unreviewed WIP — CI on this draft is its first exposure, not an endorsement.
- Rollback: the branch is additive; revert the snapshot commit to return to main's state.
