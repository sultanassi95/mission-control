#!/usr/bin/env bash
# Tests for tools/leak-guard.sh, the hook macOS and Linux actually run; the bash twin of
# leak-guard.tests.ps1. Each case feeds a PreToolUse payload on stdin and asserts the exit code
# (0 allow, 2 block). Run: bash tools/tests/leak-guard.tests.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../leak-guard.sh"
pass=0; fail=0; stderr_text=""

run() { # run <payload-json> [terms-file] -> sets RC and stderr_text
  local terms="${2:-}"
  local err; err="$(mktemp)"
  if [ -n "$terms" ]; then LEAK_GUARD_TERMS="$terms" bash "$GUARD" <<<"$1" 2>"$err"; else bash "$GUARD" <<<"$1" 2>"$err"; fi
  RC=$?
  stderr_text="$(cat "$err")"; rm -f "$err"
}
bash_payload() { jq -cn --arg c "$1" '{tool_name: "Bash", tool_input: {command: $c}}'; }
tool_payload() { jq -cn --arg t "$1" --arg b "$2" '{tool_name: $t, tool_input: {body: $b}}'; }
expect() { # expect <name> <want-rc>
  if [ "$RC" -eq "$2" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $1 (exit $RC, want $2)"; fi
}
blocks() { run "$(bash_payload "$2")"; expect "$1" 2; }
allows() { run "$(bash_payload "$2")"; expect "$1" 0; }

command -v jq >/dev/null || { echo "leak-guard tests need jq"; exit 1; }

# --- blocks: the artifact attributes the decision to a person ---
blocks "founder decided in a commit" 'git commit -m "fix(x): revert the cache, founder decided it was wrong"'
if printf '%s' "$stderr_text" | grep -q "matched 'founder decided'"; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: block message names the matched text"; fi
blocks "per the founder in a PR body" 'gh pr create --title "t" --body "Scoped per the founder to one endpoint."'
blocks "orchestration vocabulary bound to its verb" 'git commit -m "chore(x): the orchestrator dispatched the retry"'
blocks "an authorship trailer" 'git commit -m "feat(x): add thing" -m "Co-Authored-By: Claude <a@b.c>"'
run "$(tool_payload mcp__plugin_atlassian_atlassian__addCommentToJiraIssue 'Reopened because the founder said the first approach was wrong.')"; expect "a tracker comment (MCP tool)" 2

# --- allows: ordinary engineering text ---
allows "a clean commit" 'git commit -m "fix(auth): reject an expired refresh token with 401"'
allows "a clean PR body" 'gh pr create --title "t" --body "Adds request validation so a contract violation is a 4xx."'
for w in "refactor(api): delegate parsing to the codec" "fix(net): mitigate the retry storm" "feat(db): aggregate rows per tenant" \
         "fix(ui): navigate back after save" "chore: investigate flaky suite" "feat(infra): add the api gateway stage" "test(x): stub the clock in the suite"; do
  allows "false-positive family: $w" "git commit -m \"$w\""
done

# --- bypass regressions ---
blocks "despite a -c global flag" 'git -c commit.gpgsign=false commit -m "fix: founder decided to revert"'
blocks "despite a -C global flag" 'git -C fronts/x commit -m "fix: founder decided to revert"'
blocks "a file-borne commit message" 'git commit -F /tmp/msg.txt'
blocks "gh pr --body-file" 'gh pr create --body-file /tmp/b.txt'
blocks "gh pr --fill" 'gh pr create --fill'
allows "-F - with a heredoc" "git commit -F - <<EOF
fix(auth): reject an expired token
EOF"
# A lowercase -f or -F belonging to ANOTHER command on the line is not a file-borne message.
allows "rm -f beside a heredoc commit" "rm -f /tmp/a.png && git commit -F - <<EOF
fix(x): tidy
EOF"
allows "stat -f beside a commit" 'stat -f %z out.bin && git commit -m "fix(x): smaller output"'
# A -F flag of another command on the same line is not git's message flag either.
allows "grep -F beside a commit" 'grep -F needle notes.txt && git commit -m "chore: tidy notes"'
allows "awk -F with a spaced separator beside a commit" "awk -F ':' '{print \$1}' list.txt && git commit -m \"chore: list owners\""
blocks "git's own -F after other flags" 'git commit -q -F /tmp/msg.txt'
for t in mcp__x__editJiraIssue mcp__x__createConfluencePage mcp__x__addCOMMENTToIssue; do
  run "$(tool_payload "$t" 'the founder decided')"; expect "outward tool $t" 2
done
run "$(jq -cn '{tool_name: "mcp__x__getJiraIssue", tool_input: {jql: "text ~ orchestrator"}}')"; expect "does not scan a tracker read" 0
run "$(jq -cn '{tool_name: "mcp__x__searchJiraIssuesUsingJql", tool_input: {jql: "the founder decided"}}')"; expect "does not scan a tracker search" 0

# --- false positives proven in review ---
for fp in 'feat(saga): add the orchestrator service to coordinate payment steps' \
          'fix(snmp): restart the AgentX sub-agent on socket timeout' \
          'feat(llm): swap the language model provider to Anthropic' \
          'feat(chat): wire the AI assistant panel to the new provider' \
          'docs: note the open [STUB] on the fallback path, tracked in MC-010' \
          'feat(iga): notify when the resource owner approved the access request' \
          'feat(editor): insert a pause point at the marker' \
          'docs: regenerate api reference, generated with typedoc'; do
  allows "allows: ${fp:0:46}" "git commit -m \"$fp\""
done

# --- every active term blocks something: a dropped line cannot go unnoticed ---
while IFS='|' read -r term text; do
  blocks "term still blocks: $term" "git commit -m \"$text\""
done <<'CASES'
founder (said|chore: founder said revert it
per the founder|chore: scoped per the founder
as the founder (|chore: as the founder requested
the founder's (|chore: the founder's call on scope
the owner (decided|chore: the owner decided to defer
as (instructed|requested) by|chore: as instructed by the review
the orchestrator (|chore: the orchestrator dispatched two passes
sub-?agents?|chore: dispatched a sub-agent for review
the gate (passed|chore: the gate passed on retry
gate-locked|chore: gate-locked until approval
fan-?out budget|chore: fan-out budget of two agents
as an AI|chore: as an AI I cannot verify this
as a language model|chore: as a language model I inferred it
I am an? (|chore: I am an assistant and cannot merge
generated (with|by) (|docs: generated with Claude
Co-Authored-By:|feat: add thing Co-Authored-By: Claude
🤖|docs: add the page 🤖
CASES

# The table above has one row per active term: a term added without a case fails here.
active_terms="$(grep -v '^[[:space:]]*#' "$HERE/../leak-guard.terms.txt" | grep -cv '^[[:space:]]*$')"
case_rows="$(sed -n '/^done <<.CASES./,/^CASES$/p' "$0" | grep -c '|')"
if [ "$active_terms" -eq "$case_rows" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $active_terms active terms but $case_rows term cases"; fi

# --- scope: only outward commands are scanned ---
allows "a non-outward git command" 'git status --short'
allows "an unrelated command carrying a term" 'grep -rn "orchestrator" framework/'
run "$(jq -cn '{tool_name: "Read", tool_input: {file_path: "orchestrator.md"}}')"; expect "a non-matching tool" 0

# --- degenerate input ---
run ''; expect "empty payload allows" 0
run 'not json at all git'; expect "malformed json allows" 0

# --- negative controls: the suite can go red ---
tmp_terms="$(mktemp)"; printf '%s\n' '\bcompletely-ordinary-phrase\b' >"$tmp_terms"
run "$(bash_payload 'git commit -m "feat(x): a completely-ordinary-phrase here"')" "$tmp_terms"; expect "custom term list is honoured (control)" 2
run "$(bash_payload 'git commit -m "feat(x): a completely-ordinary-phrase here"')"; expect "that phrase passes under the shipped list (control)" 0
rm -f "$tmp_terms"

echo "leak-guard tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
