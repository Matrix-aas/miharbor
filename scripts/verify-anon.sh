#!/usr/bin/env bash
# verify-anon.sh — guardrail: test fixtures must never contain production
# secrets / identifiable production data.
#
# Checked against:
#   - secret prefixes from production mihomo config (ede76fbe...)
#   - WireGuard key prefixes (lvsBCoJA, b7XwTc, 61QKeVg)
#   - public IP of the production router (185.155.x.y)
#   - public MAC of the production router
#   - personal domain (thematrix.su)
#
# Exits non-zero on any match, printing the offending file(s) and line(s).
# Called from `bun test` via a Bun test runner hook *and* from CI directly.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Glob test fixtures across all workspaces.
FIXTURE_PATHS=(
  "apps/server/tests/fixtures"
  "packages/shared/tests/fixtures"
)

# Case-sensitive patterns. IP / MAC / secret prefixes are verbatim from
# production configs and must NEVER appear in committed fixtures.
PATTERNS=(
  '185\.155\.'
  '78:55:36'
  'ede76fbe'
  'lvsBCoJA'
  'b7XwTc'
  '61QKeVg'
  'thematrix'
)

failures=0
for dir in "${FIXTURE_PATHS[@]}"; do
  [[ -d "$dir" ]] || continue
  for pat in "${PATTERNS[@]}"; do
    if grep -R -n -E "$pat" "$dir" 2>/dev/null; then
      echo "ERROR: fixture under $dir matches production-secret pattern '$pat'" >&2
      failures=$((failures + 1))
    fi
  done
done

if [[ $failures -gt 0 ]]; then
  echo "verify-anon: $failures fixture(s) contain production data — refusing." >&2
  exit 1
fi

echo "verify-anon: OK (no production data in ${FIXTURE_PATHS[*]})"
