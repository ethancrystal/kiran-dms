#!/usr/bin/env bash
# Download the pinned TLA+ tools jar into a NEW, empty directory and verify its size and sha256.
# The jar is executed code, so the hash is checked before anything runs it.
# Usage: fetch-tools.sh [target-dir]   (default: ./tla-tools-1.7.4; must not exist yet)
# Prints the jar path on success; deletes the download and exits 1 on any mismatch.
set -euo pipefail
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
EXPECT_SHA=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
EXPECT_SIZE=2274532
DIR=${1:-./tla-tools-1.7.4}
for t in curl sha256sum stat; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
mkdir "$DIR"   # fails if it already exists
if ! curl -fL --proto '=https' --proto-redir '=https' --tlsv1.2 -sS -o "$DIR/tla2tools.jar" "$URL"; then rm -rf "$DIR"; echo "download failed" >&2; exit 1; fi
SIZE=$(stat -c %s "$DIR/tla2tools.jar")
SHA=$(sha256sum "$DIR/tla2tools.jar" | cut -d' ' -f1)
if [ "$SIZE" != "$EXPECT_SIZE" ] || [ "$SHA" != "$EXPECT_SHA" ]; then
  rm -rf "$DIR"; echo "size or sha256 mismatch (got $SIZE bytes, $SHA); download deleted" >&2; exit 1
fi
chmod 444 "$DIR/tla2tools.jar"
echo "$(cd "$DIR" && pwd)/tla2tools.jar"
