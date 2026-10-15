#!/usr/bin/env bash
# Every repo path and relative link a Markdown doc names must resolve (the bash twin of check-refs.ps1).
# Usage: bash tools/check-refs.sh [path ...]   (files or folders; default: every tracked .md)
exec python3 -I "$(dirname "$0")/check-refs.py" "$@"
