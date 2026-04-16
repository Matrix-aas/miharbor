#!/usr/bin/env bash
set -e
for f in "$@"; do
  [[ -f "$f" ]] || continue
  if grep -E '^(private-key|pre-shared-key): |^secret: "[a-f0-9]{32,}"' "$f" >/dev/null; then
    echo "ERROR: $f contains secrets — refused by pre-commit guard." >&2
    exit 1
  fi
done
