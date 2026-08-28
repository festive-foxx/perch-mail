#!/usr/bin/env bash
# Update dependencies and refresh the text lockfile.
#
# Usage:
#   bash scripts/update-deps.sh tanstack   # keep all @tanstack/* packages in lockstep (default)
#   bash scripts/update-deps.sh all        # update everything within semver ranges
set -euo pipefail

SCOPE="${1:-tanstack}"

before="$(bun pm ls 2>/dev/null || true)"

case "$SCOPE" in
  tanstack)
    # TanStack packages share internal APIs: bump them together or the build breaks.
    pkgs=$(node -e "
      const p = require('./package.json');
      const all = { ...p.dependencies, ...p.devDependencies };
      console.log(Object.keys(all).filter(n => n.startsWith('@tanstack/')).join(' '));
    ")
    echo "Updating: $pkgs"
    # shellcheck disable=SC2086
    bun update --latest $pkgs
    ;;
  all)
    echo "Updating all dependencies within semver ranges"
    bun update
    ;;
  *)
    echo "Unknown scope: $SCOPE (expected 'tanstack' or 'all')" >&2
    exit 1
    ;;
esac

# Always keep a text lockfile so dependency scanners can read it.
bun install --save-text-lockfile

after="$(bun pm ls 2>/dev/null || true)"

summary="$(diff <(echo "$before") <(echo "$after") || true)"
if [ -z "$summary" ]; then
  summary="No dependency changes."
fi

echo "$summary"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "summary<<EOF"
    echo "$summary"
    echo "EOF"
  } >>"$GITHUB_OUTPUT"
fi
