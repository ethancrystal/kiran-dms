#!/usr/bin/env bash
# Install the Supabase CLI and the Playwright Chromium browser inside WSL so the
# e2e-stack suite (real local Supabase stack) can run on this Windows host.
# Run from the repo root in WSL:  bash scripts/wsl-install-supabase.sh
# The CLI binary is Go, not JS; install the pinned Linux release by absolute path
# so no bun/npm global wrapper can shadow it. Nothing here touches a hosted project.
set -euo pipefail

VERSION="2.113.0"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) TARGET="linux_amd64" ;;
  aarch64|arm64) TARGET="linux_arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2; exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/supabase/cli/releases/download/v${VERSION}/supabase_${TARGET}.tar.gz"
echo "Downloading Supabase CLI ${VERSION} (${TARGET})"
curl -fSL --max-time 300 -o "$TMP/supabase.tar.gz" "$URL"

# Archive integrity: it must be a gzip tarball containing the CLI binary.
gzip -t "$TMP/supabase.tar.gz" || { echo "archive integrity check failed" >&2; exit 1; }
tar -tzf "$TMP/supabase.tar.gz" | grep -qx 'supabase' || { echo "archive has no supabase binary" >&2; exit 1; }
tar -xzf "$TMP/supabase.tar.gz" -C "$TMP" supabase
chmod +x "$TMP/supabase"
# Confirm it is an ELF executable, not a JS/Bun shim.
if [ "$(head -c 4 "$TMP/supabase" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]; then
  echo "downloaded binary is not ELF" >&2; exit 1
fi

echo "Installing to /usr/local/bin/supabase (sudo)"
sudo install -m 0755 "$TMP/supabase" /usr/local/bin/supabase
/usr/local/bin/supabase --version

# Docker daemon must be reachable; supabase start needs it.
if command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker/Podman CLI found but the daemon is not reachable; start it before running the stack." >&2
    exit 1
  fi
  echo "Docker/Podman daemon OK"
else
  echo "docker command not found; install Docker or Podman before running the stack." >&2
  exit 1
fi

# Playwright Chromium for the browser tests.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
if command -v pnpm >/dev/null 2>&1; then
  pnpm -C apps/web exec playwright install chromium
elif command -v npm >/dev/null 2>&1; then
  (cd apps/web && npm exec -- playwright install chromium)
else
  echo "pnpm or npm is required to install Playwright Chromium" >&2; exit 1
fi

echo "WSL stack prerequisites installed. Next: npm run test:e2e:stack"
