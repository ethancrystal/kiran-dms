#!/usr/bin/env bash
# Parse the spec, model-check every config, run the reachability witnesses, and compare each
# result with the expected one. Exits 1 if anything differs, crashes or prints no result.
# Usage: run-all.sh path/to/tla2tools.jar [--quick | --medium | --full]
#   tla2tools.jar: TLA+ tools v1.7.4 or later (fetch-tools.sh downloads the pinned one).
#   --quick   parse, the three mutants, OpenQ5 and the witnesses: seconds to a minute or two.
#   --medium  --quick plus TwoOwnersSmall and TwoOwnersMid: tens of minutes on a small host.
#   --full    (default) --medium plus the two clean runs ApprovalLifecycle and TwoOwners: hours.
# Environment: TLC_WORKERS (default auto), TLC_JAVA_OPTS (default empty, e.g. "-Xmx1g").
set -euo pipefail
JAR=$(realpath "${1:?path to tla2tools.jar}")
MODE=${2:---full}
case "$MODE" in --quick|--medium|--full) ;; *) echo "unknown mode $MODE"; exit 2 ;; esac
WORKERS=${TLC_WORKERS:-auto}
SPEC_DIR=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
cp "$SPEC_DIR"/*.tla "$SPEC_DIR"/*.cfg "$OUT"/
cd "$OUT"
FAIL=0
NOERR="Model checking completed. No error has been found"

check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '%-26s ok        %s\n' "$1" "$3"
  else printf '%-26s MISMATCH  expected [%s], got [%s]\n' "$1" "$2" "${3:-no result line}"; FAIL=1; fi
}

result_of() { grep -oE '(Invariant|Action property) [A-Za-z0-9_]+ is violated|Model checking completed. No error has been found' "$1.log" | head -1 || true; }

tlc() { # $1 config name, $2 module, $3 expected result
  # shellcheck disable=SC2086
  java -XX:+UseParallelGC ${TLC_JAVA_OPTS:-} -cp "$JAR" tlc2.TLC -workers "$WORKERS" -metadir "states-$1" \
       -config "$1.cfg" "$2" > "$1.log" 2>&1 || true
  check "$1" "$3" "$(result_of "$1")"
}

for m in ApprovalLifecycle Witness; do
  java -cp "$JAR" tla2sany.SANY "$m.tla" > "sany-$m.log" 2>&1 || true
  if grep -q '\*\*\* Errors' "sany-$m.log" || ! grep -q 'Semantic processing of module' "sany-$m.log"; then
    cat "sany-$m.log"; echo "SANY: $m.tla did not parse"; exit 1
  fi
  echo "SANY: $m.tla parsed, no errors"
done

tlc MutantReuse      ApprovalLifecycle.tla "Invariant S2_SingleUse is violated"
tlc MutantNoCoverage ApprovalLifecycle.tla "Invariant S3_GatedActionCovered is violated"
tlc MutantNoRecheck  ApprovalLifecycle.tla "Invariant S4_CheckerLevelAtUse is violated"
tlc OpenQ5           ApprovalLifecycle.tla "Invariant Q5_CheckerActiveAtUse is violated"

# Witnesses: each claims "this never happens"; TLC must report it violated, i.e. the scenario is reachable.
# They use the constants, SYMMETRY and CONSTRAINT of the config's first part (up to CHECK_DEADLOCK).
base=$(sed -n '1,/^CHECK_DEADLOCK/p' ApprovalLifecycle.cfg)
for w in W1_WriteOffUsed W2_NoCheckerUse W3_OwnerDiscountUsed W4_Rejected W5_Cancelled \
         W6_TwoUses W7_ManagerCheckedUsed W9_OffboardedMaker R1_DecidedLevelAtUse; do
  printf '%s\nINVARIANT %s\n' "$base" "$w" > "$w.cfg"
  tlc "$w" Witness.tla "Invariant $w is violated"
done
printf '%s\nPROPERTY A1_NeverEscalate\n' "$base" > A1_NeverEscalate.cfg
tlc A1_NeverEscalate Witness.tla "Action property A1_NeverEscalate is violated"
# W10 needs two owners, so it uses the constants of TwoOwners.cfg.
base2=$(sed -n '1,/^CHECK_DEADLOCK/p' TwoOwners.cfg)
printf '%s\nINVARIANT W10_OwnerWriteOffApproved\n' "$base2" > W10_OwnerWriteOffApproved.cfg
tlc W10_OwnerWriteOffApproved Witness.tla "Invariant W10_OwnerWriteOffApproved is violated"

if [ "$MODE" != "--quick" ]; then
  tlc TwoOwnersSmall ApprovalLifecycle.tla "$NOERR"
  tlc TwoOwnersMid   ApprovalLifecycle.tla "$NOERR"
fi
if [ "$MODE" = "--full" ]; then
  tlc ApprovalLifecycle ApprovalLifecycle.tla "$NOERR"
  tlc TwoOwners         ApprovalLifecycle.tla "$NOERR"
fi

echo "logs: $OUT"
if [ "$FAIL" -ne 0 ]; then echo "RESULT: MISMATCH (see above)"; exit 1; fi
echo "RESULT: all results as expected ($MODE)"
