#!/usr/bin/env bash
# Parse the spec, model-check every config, and run the reachability witnesses.
# Usage: run-all.sh path/to/tla2tools.jar [--quick]
#   tla2tools.jar: TLA+ tools v1.7.4 or later.
#   --quick skips the two clean runs (ApprovalLifecycle, TwoOwners), which take
#   tens of minutes; everything else finishes in seconds.
set -euo pipefail
JAR=$(realpath "${1:?path to tla2tools.jar}")
QUICK=${2:-}
SPEC_DIR=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
cp "$SPEC_DIR"/*.tla "$SPEC_DIR"/*.cfg "$OUT"/
cd "$OUT"

java -cp "$JAR" tla2sany.SANY ApprovalLifecycle.tla > sany.log 2>&1 \
  && ! grep -q '\*\*\* Errors' sany.log && echo "SANY: parsed, no errors" || { cat sany.log; exit 1; }

tlc() { # $1 config name, $2 module
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -metadir "states-$1" \
       -config "$1.cfg" "$2" > "$1.log" 2>&1 || true
  printf '%-22s %s\n' "$1" "$(grep -oE '(Invariant|Action property) [A-Za-z0-9_]+ is violated|Model checking completed. No error has been found' "$1.log" | head -1)"
}

for c in MutantReuse MutantNoCoverage MutantNoRecheck OpenQ5; do tlc "$c" ApprovalLifecycle.tla; done
if [ "$QUICK" != "--quick" ]; then
  for c in ApprovalLifecycle TwoOwners; do tlc "$c" ApprovalLifecycle.tla; done
fi

base=$(sed -n '1,/^CHECK_DEADLOCK/p' ApprovalLifecycle.cfg)
for w in W1_WriteOffUsed W2_NoCheckerUse W3_OwnerDiscountUsed W4_Rejected W5_Cancelled \
         W6_TwoUses W7_ManagerCheckedUsed W9_OffboardedMaker R1_DecidedLevelAtUse; do
  printf '%s\nINVARIANT %s\n' "$base" "$w" > "$w.cfg"
  tlc "$w" Witness.tla
done
printf '%s\nPROPERTY A1_NeverEscalate\n' "$base" > A1_NeverEscalate.cfg
tlc A1_NeverEscalate Witness.tla
echo "logs: $OUT"
