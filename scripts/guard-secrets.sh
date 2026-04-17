#!/usr/bin/env bash
# Pre-commit secret guard — refuses to stage files containing obvious secrets.
# C4: broadened patterns to catch indented YAML, capital-case, .env-style, and
# common API key prefixes.
#
# Patterns (case-insensitive, extended regex):
#   - YAML keys  private-key / pre-shared-key   (any indent)
#   - YAML      secret: "<32+ hex>"             (any indent)
#   - .env      {ANTHROPIC,OPENAI}_API_KEY=sk-* (optional quotes)
#   - bare sk-ant-* and sk-* tokens in plain text
#   - *_token/token assignments with 20+ chars of payload
set -e

PATTERNS='(^|[[:space:]])(private-key|pre-shared-key)[[:space:]]*:|^[[:space:]]*secret[[:space:]]*:[[:space:]]*"[a-f0-9]{32,}"|(ANTHROPIC|OPENAI)_API_KEY[[:space:]]*=[[:space:]]*"?sk-[a-zA-Z0-9_-]{15,}|sk-ant-[a-zA-Z0-9_-]{20,}|(^|[[:space:]])[a-z0-9_-]*_?token[[:space:]]*[:=][[:space:]]*"?[a-zA-Z0-9_.-]{20,}'

# Paths matched by these globs are test fixtures and are known to contain
# placeholder-only key material (all-zero secret, AAAA/BBBB/CCCC keys).
# `scripts/verify-anon.sh` is the stricter check for those paths — it refuses
# any real production data.
is_fixture() {
  case "$1" in
    *tests/fixtures/*|*tests/fixtures) return 0 ;;
    *) return 1 ;;
  esac
}

for f in "$@"; do
  [[ -f "$f" ]] || continue
  if is_fixture "$f"; then
    continue
  fi
  if grep -iE "$PATTERNS" "$f" >/dev/null 2>&1; then
    echo "ERROR: $f contains secrets — refused by pre-commit guard." >&2
    exit 1
  fi
done
