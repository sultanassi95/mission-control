#!/usr/bin/env bash
# Repro for T-001: field-level offline-sync conflict drops the earlier edit.
# Prevention infrastructure - tracked with the ticket so the next session (or a
# reviewer) can reproduce the data loss in one command instead of by hand.
# Writes captured payloads to ../samples/ (gitignored, local only).
set -euo pipefail

API="${FIELDKIT_API:-http://localhost:8080}"
PLOT=14
OUT="$(dirname "$0")/../samples"
mkdir -p "$OUT"

echo "1. seed plot $PLOT note"
curl -sf "$API/notes" -d "{\"plot\":$PLOT,\"ph\":6.1,\"moisture\":30}" >"$OUT/seed.json"

echo "2. device A edits pH offline; device B edits moisture offline"
curl -sf "$API/sync" -d @<(echo "{\"plot\":$PLOT,\"ph\":6.4}")      >"$OUT/a-sync.json"
curl -sf "$API/sync" -d @<(echo "{\"plot\":$PLOT,\"moisture\":42}") >"$OUT/b-sync.json"

echo "3. read the terminal artifact - the stored note (NOT the sync event count)"
curl -sf "$API/notes/$PLOT" | tee "$OUT/after.json"

echo
echo "PASS if after.json has ph=6.4 AND moisture=42. FAIL (current) drops ph."
