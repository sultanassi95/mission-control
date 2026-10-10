#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Blocks a command that reads `$?` right
# after a pipeline into a presentation tool, because `$?` then reports the
# pager, which never fails: `cmd | tail; echo $?` printed a failure and
# exit=0 in the same breath on three real runs, one a security gate
# (_command/learning/13). Exit 2 blocks and the stderr reaches the model.
#
# `$?` reports the LAST command run, so the check is per statement: split the
# command on `;`, `&&`, `||` and newlines, and block only when the statement
# immediately BEFORE a `$?` read is a pipeline ending in a pager. A pipe
# elsewhere in the same command does not count (the guard's first live run
# blocked exactly that shape and is now a test). Allowed: direct capture
# (`cmd > log 2>&1; rc=$?`), `set -o pipefail`, `${PIPESTATUS[0]}`.
set -uo pipefail
payload="$(cat)"
case "$payload" in *'"Bash"'*) ;; *) exit 0 ;; esac
case "$payload" in *'$?'*|*'${?}'*) ;; *) exit 0 ;; esac
command -v python3 >/dev/null 2>&1 || exit 0
printf '%s' "$payload" | python3 -c '
import json, re, sys
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if p.get("tool_name") != "Bash":
    sys.exit(0)
cmd = (p.get("tool_input") or {}).get("command") or ""
if re.search(r"pipefail|PIPESTATUS", cmd):
    sys.exit(0)
pager = r"(tail|head|grep|egrep|fgrep|sed|awk|jq|tee|less|more|cut|sort|uniq|wc|tr|column)"
ends_in_pager = re.compile(r"\|\s*" + pager + r"\b[^|]*$")
reads_status = re.compile(r"\$(\?|\{\?\})")
stmts = [s.strip() for s in re.split(r";|&&|\|\||\n", cmd)]
for i, s in enumerate(stmts):
    if not reads_status.search(s):
        continue
    head = re.split(r"\$(?:\?|\{\?\})", s, maxsplit=1)[0]
    if "|" in head and ends_in_pager.search(head):
        prev = head
    else:
        j = i - 1
        while j >= 0 and not stmts[j]:
            j -= 1
        prev = stmts[j] if j >= 0 else ""
    m = ends_in_pager.search(prev)
    if m:
        tool = re.search(pager, m.group(0)).group(1)
        sys.stderr.write(
            "status-after-pipe-guard: BLOCKED - $? is read right after a pipe into "
            + repr(tool) + ", so it reports " + repr(tool) + ", not the command.\n"
            "Capture the status on the command own line: cmd > log 2>&1; rc=$?; tail log\n"
            "or use set -o pipefail / ${PIPESTATUS[0]} if the pipeline itself is measured.\n")
        sys.exit(2)
sys.exit(0)
'
