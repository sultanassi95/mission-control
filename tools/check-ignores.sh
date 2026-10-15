#!/usr/bin/env bash
# The ignore rules deliver what the docs promise (the bash twin of check-ignores.ps1; same lists).
# Usage: bash tools/check-ignores.sh [root]
exec python3 -I "$(dirname "$0")/check-ignores.py" "$@"
