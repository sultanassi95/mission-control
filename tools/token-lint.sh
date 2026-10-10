#!/usr/bin/env bash
# Design-token ratchet entry point - see tools/token-lint.py and
# framework/design-standard.md, "The gates".
set -euo pipefail
exec python3 "$(dirname "$0")/token-lint.py" "$@"
