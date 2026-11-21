#!/usr/bin/env bash
# Apply every migration on `main` to a fresh Supabase project, in file-name order.
# The migration set is taken from `main`, so this can be run from any branch.
#
#   KIRAN_DB_URL='postgresql://...' bash scripts/apply-kiran-fresh.sh --dry-run
#   KIRAN_DB_URL='postgresql://...' bash scripts/apply-kiran-fresh.sh
#
# H-19: run it only with MJ's approval of exactly this change. The dry-run writes nothing.
set -euo pipefail

REF="jlanskjgpuyycarwjafn"
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${KIRAN_DB_URL:-}" ]]; then
  echo "Set KIRAN_DB_URL to the new project connection string first." >&2
  exit 2
fi
if [[ "$KIRAN_DB_URL" != *"$REF"* ]]; then
  echo "Refusing: KIRAN_DB_URL is not the new Kiran project ($REF)." >&2
  exit 2
fi

ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# main is the source of truth for the migration set and supabase/config.toml.
git -C "$ROOT" archive main supabase | tar -x -C "$TMP"

cd "$TMP"
if [[ "$DRY" -eq 1 ]]; then
  supabase db push --db-url "$KIRAN_DB_URL" --include-all --dry-run --yes
else
  supabase db push --db-url "$KIRAN_DB_URL" --include-all --yes
fi
