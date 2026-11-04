#!/usr/bin/env bash
# SessionStart and UserPromptSubmit hook. Records that a named terminal session exists, so the
# Mission Control App can show it: writes <home>/sessions/<name>.json from the hook payload
# (session_id, transcript_path, cwd and session_title, the name `claude -n <name>` gave it).
# A prompt that opens with `/console app --code <name>` binds that name instead, which names a
# session that was started without -n. Never blocks and prints nothing: exit 0 always.
set -uo pipefail
payload="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0
home="${MCAPP_HOME:-$HOME/.mission-control}"
field() { printf '%s' "$payload" | jq -r "$1 // empty" 2>/dev/null; }
sid="$(field .session_id)"; tp="$(field .transcript_path)"
[ -n "$sid" ] && [ -n "$tp" ] || exit 0
name="$(field .session_title)"
prompt="$(field .prompt)"
bound="$(printf '%s' "$prompt" | head -1 | sed -n -E 's#^[[:space:]]*/console[[:space:]]+app[[:space:]]+--code[=[:space:]]+([A-Za-z0-9._-]+).*#\1#p' | head -1)"
[ -n "$bound" ] && name="$bound"
name="$(printf '%s' "$name" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9._-]+/-/g; s/^[^a-z0-9]+//' | cut -c1-41 | sed -E 's/[-.]+$//')"
[ -n "$name" ] || exit 0
dir="$home/sessions"
umask 077
mkdir -p "$dir" 2>/dev/null || exit 0
chmod 700 "$home" "$dir" 2>/dev/null
# The session's process: the hook runs as its child. A hook run by a wrapper shell reports that shell, which dies with the call; say so by a pid of 0 only when it is gone.
pid="$PPID"
tmp="$dir/.$name.$$"
jq -n --arg name "$name" --arg sid "$sid" --arg tp "$tp" --arg cwd "$(field .cwd)" --arg pane "${TMUX_PANE:-}" --argjson pid "$pid" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{name:$name, session_id:$sid, transcript_path:$tp, cwd:$cwd, role:"flight", pid:$pid, tmux_pane:$pane, at:$at}' > "$tmp" 2>/dev/null \
  && mv "$tmp" "$dir/$name.json" 2>/dev/null
rm -f "$tmp" 2>/dev/null
exit 0
