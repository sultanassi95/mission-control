#!/usr/bin/env bash
# leak-sweep.sh - bash twin of leak-sweep.ps1. Keep the two in step: the
# rules, the files each mode reads, where the deny-list is read from and the
# exit codes.
# Usage: tools/leak-sweep.sh [promote|instance] [root]
#
# promote reads every file that ships: in a git work tree, each file git
# tracks and each new one it would add (untracked and not ignored); outside
# one, every file under the root but .git and the instance (_command/). It
# skips binary files, vendored or generated ones, and the test fixtures that
# plant a leak on purpose (skip_in_promote below).
#
# promote reads the operator's deny-list from the instance,
# _command/leak-sweep.private.txt beside this tools/ folder (gitignored with
# the rest of _command/), or from the file LEAK_SWEEP_PRIVATE_LIST names, for
# a run from a clone or worktree with no instance of its own. With no list
# it exits 2: a sweep that never checked the operator's own names is not clean.
set -eu
# Bytes, not characters. In a UTF-8 locale the BSD grep macOS ships never
# matches a line that holds a byte which is not UTF-8 (a Windows-1252 quote, a
# Latin-1 accent), so a term on such a line passed the sweep unseen.
export LC_ALL=C

MODE="${1:-promote}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${2:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PRIVATE_LIST="${LEAK_SWEEP_PRIVATE_LIST:-$(cd "$SCRIPT_DIR/.." && pwd)/_command/leak-sweep.private.txt}"
# Where the list used to live; read never, named in the error so a list left
# there is moved rather than silently skipped.
LEGACY_LIST="$SCRIPT_DIR/leak-sweep.private.txt"
EXEMPT_MARKER='MC-LEAK-EXEMPT:'

if [ "$MODE" != "promote" ] && [ "$MODE" != "instance" ]; then
  echo "usage: tools/leak-sweep.sh [promote|instance] [root]" >&2
  exit 2
fi

# promote guards the PUBLIC repo, so it reads every file that ships, not a list
# of folders: a list once left tools/ unread, and real front names shipped in
# its fixtures and comments.
TARGETS=()

# Files promote does not read: not written here, or planted on purpose.
skip_in_promote() {
  case "$1" in
    # vendored or generated
    node_modules/*|*/node_modules/*|vendor/*|*/vendor/*|.docs-viewer-cache/*|*/.docs-viewer-cache/*) return 0 ;;
    */.claude-plugin/types/*|*.min.js|*.min.css) return 0 ;;
    package-lock.json|*/package-lock.json|pnpm-lock.yaml|*/pnpm-lock.yaml|yarn.lock|*/yarn.lock) return 0 ;;
    # the leaks the sweep's own tests plant, one per rule
    tools/tests/fixtures/dirty/*) return 0 ;;
    # an operator's list, wherever it was left
    leak-sweep.private.txt|*/leak-sweep.private.txt) return 0 ;;
  esac
  return 1
}

RULE_NAMES=(windows-user-path unix-home-path email aws-access-key github-token generic-secret aws-account-id legacy-name model-pin)
RULE_PATTERNS=(
  '[A-Za-z]:\\Users\\[^\\ "<][^\\ "]*'
  '/(home|Users)/[A-Za-z0-9_.-]+'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  '(api[_-]?key|client[_-]?secret|access[_-]?token)[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
  '\<[0-9]{12}\>'
  '\<pmc\>' # MC-LEAK-EXEMPT: the legacy-name rule's own pattern
  '\<(opus|sonnet|haiku|gpt|gemini|claude)[ -]?[0-9]+(\.[0-9]+)?\>|claude-[a-z]+-[0-9]'
)
RULE_ICASE=(0 0 0 0 0 1 0 1 1)

# Instance mode guards a PRIVATE instance: leftover template placeholders and
# live secrets. The generic identity rules and the deny-list guard the PUBLIC
# repo only - an instance legitimately contains its own founder's paths and
# email, and names the fronts and the employer the deny-list keeps out of
# what ships.
#
# It also reads a different tree: the instance (_command/ plus the operating
# CLAUDE.md), matching `leak-sweep.ps1 -Mode instance -Path _command,CLAUDE.md`.
# Pointing it at framework/ instead reported the kit templates' deliberate
# <PLACEHOLDER-...> blanks as leaks while never opening _command/ at all.
if [ "$MODE" = "instance" ]; then
  TARGETS=(_command CLAUDE.md)
  # The identity rules stay off because an instance legitimately holds its own
  # founder's paths and email. A live credential is never legitimate there, so
  # the secret rules stay ON. Measured across _command/ before choosing: the
  # three secret rules hit 0 lines, user paths 815, email 957, twelve-digit ids
  # 6366. That is the whole argument for which three are kept.
  RULE_NAMES=(leftover-placeholder aws-access-key github-token generic-secret)
  # The brace token is a bare identifier ({{PROJECT_NAME}}). `[^}]+` also
  # matched Mermaid's hexagon node syntax ({{"label"}}), so every diagram-first
  # doc carrying one reported as an unfilled blank.
  RULE_PATTERNS=(
    '<PLACEHOLDER[^>]*>|\{\{[A-Za-z0-9_.-]+\}\}|TODO-INIT'
    'AKIA[0-9A-Z]{16}'
    'gh[pousr]_[A-Za-z0-9]{20,}'
    '(api[_-]?key|client[_-]?secret|access[_-]?token)[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
  )
  RULE_ICASE=(0 0 0 1)
fi

PRIVATE_TERMS=()
PRIVATE_PATTERNS=()
if [ "$MODE" = "promote" ]; then
  # A missing list used to pass with PrivateTerms=0, so the operator's own
  # names went unchecked while the sweep reported clean. An empty list is a
  # choice someone made; a missing one is not.
  if [ ! -r "$PRIVATE_LIST" ] || [ -d "$PRIVATE_LIST" ]; then
    echo "LEAK-SWEEP ERROR: no private deny-list at '$PRIVATE_LIST', so the operator's own names cannot be checked." >&2
    if [ -f "$LEGACY_LIST" ]; then
      echo "  A list sits at the old path '$LEGACY_LIST': move it into the instance, to the path above." >&2
    else
      echo "  Create it with one term per line ('#' starts a comment), or set LEAK_SWEEP_PRIVATE_LIST to a list elsewhere." >&2
    fi
    exit 2
  fi
  while IFS= read -r term || [ -n "$term" ]; do
    case "$term" in
      ''|'#'*) continue ;;
    esac
    PRIVATE_TERMS+=("$term")
    # Escaped once here, not once per line of every file. Matched without
    # regard to case: a name is the same name capitalised.
    PRIVATE_PATTERNS+=("\<$(printf '%s' "$term" | sed -e 's/[][\.*^$()+?{}|]/\\&/g')\>")
  done < "$PRIVATE_LIST"
fi

FILES=()
MISSING=()
LISTED=""
# What promote listed but did not read, counted so the clean line says so.
NOT_BY_NAME=0
NOT_BINARY=0
NOT_DELETED=0
if [ "$MODE" = "promote" ]; then
  add_promote() {
    if skip_in_promote "$1"; then NOT_BY_NAME=$((NOT_BY_NAME + 1)); return 0; fi
    # Tracked, but deleted in this work tree.
    if [ ! -e "$ROOT/$1" ]; then NOT_DELETED=$((NOT_DELETED + 1)); return 0; fi
    # grep -I reads a file with a NUL byte as binary and finds no match in it,
    # so a binary file, or an empty one, which holds no text, is left out here
    # rather than read line by line. An unreadable file goes on to fail below.
    if [ -r "$ROOT/$1" ]; then
      status=0
      grep -Iq . "$ROOT/$1" || status=$?
      if [ "$status" -eq 1 ]; then NOT_BINARY=$((NOT_BINARY + 1)); return 0; fi
      if [ "$status" -gt 1 ]; then
        echo "LEAK-SWEEP ERROR: grep exit $status on '$1' while telling text from binary." >&2
        exit 2
      fi
    fi
    FILES+=("$ROOT/$1")
  }
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    LISTED="every file git lists"
    while IFS= read -r -d '' rel; do
      add_promote "$rel"
    done < <(git -C "$ROOT" ls-files -z --cached --others --exclude-standard)
  else
    LISTED="every file under the root"
    while IFS= read -r -d '' f; do
      add_promote "${f#"$ROOT"/}"
    done < <(find "$ROOT" \( -path "$ROOT/.git" -o -path "$ROOT/_command" \) -prune -o -type f -print0)
  fi
fi
for t in ${TARGETS[@]+"${TARGETS[@]}"}; do
  full="$ROOT/$t"
  if [ -d "$full" ]; then
    before=${#FILES[@]}
    while IFS= read -r f; do
      FILES+=("$f")
    done < <(find "$full" -type f \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.docs-viewer-cache/*' \
      -not -name 'leak-sweep.private.txt')
    [ ${#FILES[@]} -eq "$before" ] && MISSING+=("$t (empty)")
  elif [ -f "$full" ]; then
    FILES+=("$full")
  else
    MISSING+=("$t (absent)")
  fi
done

# A target that is not there was not checked, so it cannot be reported clean.
# Per target, not just globally: instance mode reads _command/ + CLAUDE.md, and
# a globally-non-empty check passes on CLAUDE.md alone while _command/ is
# missing or misnamed - which is exactly the state liftoff step 5 exists to
# catch.
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "LEAK-SWEEP ERROR: mode=${MODE} target(s) not scanned under '$ROOT': ${MISSING[*]}" >&2
  exit 2
fi

# Backstop for the whole-set case.
if [ ${#FILES[@]} -eq 0 ]; then
  echo "LEAK-SWEEP ERROR: no files under '$ROOT' for mode=${MODE} (${LISTED:-targets: ${TARGETS[*]}})." >&2
  exit 2
fi

HITS=()
for file in "${FILES[@]}"; do
  rel="${file#"$ROOT"/}"

  # A file the sweep cannot open has not been checked, so it can never count as
  # clean. Before the prefilter this surfaced as a fatal redirect error; the
  # prefilter would instead activate no rules and skip the file silently.
  if [ ! -r "$file" ]; then
    echo "LEAK-SWEEP ERROR: cannot read '$rel'. Unreadable is not clean." >&2
    exit 2
  fi

  # Whole-file prefilter: only rules and terms that appear SOMEWHERE in this
  # file enter the per-line loop. A clean file costs one grep per rule instead
  # of one grep per rule per line, and the prefilter is a superset of the
  # per-line result, so no hit can be missed.
  #
  # grep exit 1 means no match; anything above 1 is an error (unreadable file,
  # invalid pattern) and must abort. Collapsing both into "no match" is how a
  # broken rule silently stops guarding every file it was meant to cover.
  ACTIVE_RULES=()
  i=0
  while [ $i -lt ${#RULE_NAMES[@]} ]; do
    status=0
    if [ "${RULE_ICASE[$i]}" = "1" ]; then
      grep -Eqi -- "${RULE_PATTERNS[$i]}" "$file" || status=$?
    else
      grep -Eq -- "${RULE_PATTERNS[$i]}" "$file" || status=$?
    fi
    if [ "$status" -eq 0 ]; then
      ACTIVE_RULES+=("$i")
    elif [ "$status" -gt 1 ]; then
      echo "LEAK-SWEEP ERROR: grep exit $status on '$rel' for rule ${RULE_NAMES[$i]}." >&2
      exit 2
    fi
    i=$((i + 1))
  done
  ACTIVE_TERMS=()
  j=0
  while [ $j -lt ${#PRIVATE_TERMS[@]} ]; do
    status=0
    grep -Eqi -- "${PRIVATE_PATTERNS[$j]}" "$file" || status=$?
    if [ "$status" -eq 0 ]; then
      ACTIVE_TERMS+=("$j")
    elif [ "$status" -gt 1 ]; then
      echo "LEAK-SWEEP ERROR: grep exit $status on '$rel' for private term ${PRIVATE_TERMS[$j]}." >&2
      exit 2
    fi
    j=$((j + 1))
  done
  if [ ${#ACTIVE_RULES[@]} -eq 0 ] && [ ${#ACTIVE_TERMS[@]} -eq 0 ]; then
    continue
  fi

  lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in
      *"$EXEMPT_MARKER"*) continue ;;
    esac
    for i in ${ACTIVE_RULES[@]+"${ACTIVE_RULES[@]}"}; do
      rname="${RULE_NAMES[$i]}"
      pattern="${RULE_PATTERNS[$i]}"
      icase="${RULE_ICASE[$i]}"
      if [ "$icase" = "1" ]; then
        matches="$(printf '%s' "$line" | grep -Eoi -- "$pattern" || true)"
      else
        matches="$(printf '%s' "$line" | grep -Eo -- "$pattern" || true)"
      fi
      if [ -n "$matches" ]; then
        while IFS= read -r m; do
          [ -n "$m" ] && HITS+=("$rel:$lineno: [$rname] $m")
        done <<< "$matches"
      fi
    done
    for j in ${ACTIVE_TERMS[@]+"${ACTIVE_TERMS[@]}"}; do
      if printf '%s' "$line" | grep -Eqi -- "${PRIVATE_PATTERNS[$j]}"; then
        HITS+=("$rel:$lineno: [private-term] ${PRIVATE_TERMS[$j]}")
      fi
    done
  done < "$file"
done

if [ ${#HITS[@]} -gt 0 ]; then
  for h in ${HITS[@]+"${HITS[@]}"}; do
    printf '%s\n' "$h"
  done
  echo "LEAK-SWEEP FAILED: ${#HITS[@]} hit(s). Mode=${MODE}."
  exit 1
fi
if [ "$MODE" = "promote" ]; then
  NOT_READ="${NOT_BINARY} binary or empty, ${NOT_BY_NAME} skipped by name"
  [ "$NOT_DELETED" -gt 0 ] && NOT_READ="${NOT_READ}, ${NOT_DELETED} deleted from the work tree"
  echo "LEAK-SWEEP CLEAN: 0 hits across ${#FILES[@]} file(s), ${LISTED}; not read: ${NOT_READ}. Mode=${MODE}. PrivateTerms=${#PRIVATE_TERMS[@]} from ${PRIVATE_LIST}."
else
  echo "LEAK-SWEEP CLEAN: 0 hits across ${#FILES[@]} file(s). Mode=${MODE}. The deny-list is for what ships, so this mode does not read it."
fi
exit 0
