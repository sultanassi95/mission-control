#!/usr/bin/env bash
# E4 gate entry point - see tools/epic-coverage.py. A .ps1 twin is deferred
# until a Windows operator exists.
set -euo pipefail
exec python3 "$(dirname "$0")/epic-coverage.py" "$@"
