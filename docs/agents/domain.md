# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **multi-context**. The contexts are business contexts, not code packages: one context can span `supabase/migrations/`, `apps/web/` and `packages/import/`.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: the seven contexts, the shared kernel, and the seams between contexts. It points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/contexts/<name>/CONTEXT.md`**: the glossary for one context.
- **`docs/adr/`**: system-wide decisions. Context-specific decisions live in `docs/contexts/<name>/adr/`.
- The planning set `docs/00` to `docs/13` stays the source of truth for requirements and fixed decisions (doc 12). If a `CONTEXT.md` disagrees with a planning doc, the planning doc wins; flag the gap.

If any of the context or ADR files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md                      <- contexts + shared kernel
├── docs/
│   ├── 00-README.md ... 13-...         <- planning set (authoritative)
│   ├── adr/                            <- system-wide decisions
│   └── contexts/
│       ├── salon-pipeline/CONTEXT.md
│       ├── field-operations/CONTEXT.md
│       ├── orders-delivery/CONTEXT.md
│       ├── money-credit/CONTEXT.md
│       ├── inventory/CONTEXT.md
│       ├── supplier-vault/CONTEXT.md   <- vocabulary only, never supplier data
│       └── control-governance/CONTEXT.md
└── supabase/  apps/web/  packages/import/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Many words mean different things in different contexts (see the homonym list in `CONTEXT-MAP.md`). Always qualify an ambiguous term with its context.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Supplier vault

`docs/contexts/supplier-vault/CONTEXT.md` may define vocabulary only. It must never contain supplier identity, cost, terms or any classified value (H-01, H-02; doc 07).

## Flag ADR conflicts

If your output contradicts an existing ADR or a fixed decision in doc 12, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

Never reopen a fixed decision on your own: that is a BLOCKER for MJ (ACTIVITY §9).
