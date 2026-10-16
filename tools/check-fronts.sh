#!/usr/bin/env bash
# Every front's folder holds its repositories, fronts/<front>/<repo> (framework/task-board.md, front placement).
# Usage: bash tools/check-fronts.sh [root]
exec python3 -I "$(dirname "$0")/check-fronts.py" "$@"
