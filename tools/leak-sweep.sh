#!/usr/bin/env bash
# leak-sweep.sh - bash twin of leak-sweep.ps1.
# Usage: tools/leak-sweep.sh [promote|instance] [root]
set -eu

MODE="${1:-promote}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${2:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PRIVATE_LIST="$SCRIPT_DIR/leak-sweep.private.txt"
EXEMPT_MARKER='MC-LEAK-EXEMPT:'

if [ "$MODE" != "promote" ] && [ "$MODE" != "instance" ]; then
  echo "usage: tools/leak-sweep.sh [promote|instance] [root]" >&2
  exit 2
fi

TARGETS=(framework .claude/skills README.md LIFTOFF.md CLAUDE.md CHANGELOG.md)

RULE_NAMES=(windows-user-path unix-home-path email aws-access-key github-token generic-secret aws-account-id legacy-name model-pin)
RULE_PATTERNS=(
  '[A-Za-z]:\\Users\\[^\\ "<][^\\ "]*'
  '/(home|Users)/[A-Za-z0-9_.-]+'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  '(api[_-]?key|client[_-]?secret|access[_-]?token)[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
  '\<[0-9]{12}\>'
  '\<pmc\>'
  '\<(opus|sonnet|haiku|gpt|gemini|claude)[ -]?[0-9]+(\.[0-9]+)?\>|claude-[a-z]+-[0-9]'
)
RULE_ICASE=(0 0 0 0 0 1 0 1 1)

# Instance mode guards a PRIVATE instance: leftover template placeholders +
# the operator's deny-list (if present). The generic identity rules guard the
# PUBLIC repo only - an instance legitimately contains its own founder's
# paths and email.
if [ "$MODE" = "instance" ]; then
  RULE_NAMES=(leftover-placeholder)
  RULE_PATTERNS=('<PLACEHOLDER[^>]*>|\{\{[^}]+\}\}|TODO-INIT')
  RULE_ICASE=(0)
fi

PRIVATE_TERMS=()
if [ -f "$PRIVATE_LIST" ]; then
  while IFS= read -r term || [ -n "$term" ]; do
    case "$term" in
      ''|'#'*) continue ;;
    esac
    PRIVATE_TERMS+=("$term")
  done < "$PRIVATE_LIST"
fi

FILES=()
for t in "${TARGETS[@]}"; do
  full="$ROOT/$t"
  if [ -d "$full" ]; then
    while IFS= read -r f; do
      FILES+=("$f")
    done < <(find "$full" -type f \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.docs-viewer-cache/*' \
      -not -name 'leak-sweep.private.txt')
  elif [ -f "$full" ]; then
    FILES+=("$full")
  fi
done

HITS=()
for file in "${FILES[@]}"; do
  rel="${file#"$ROOT"/}"
  lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    case "$line" in
      *"$EXEMPT_MARKER"*) continue ;;
    esac
    i=0
    while [ $i -lt ${#RULE_NAMES[@]} ]; do
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
      i=$((i + 1))
    done
    for term in "${PRIVATE_TERMS[@]}"; do
      escaped="$(printf '%s' "$term" | sed -e 's/[][\.*^$()+?{}|]/\\&/g')"
      if printf '%s' "$line" | grep -Eq -- "\<${escaped}\>"; then
        HITS+=("$rel:$lineno: [private-term] $term")
      fi
    done
  done < "$file"
done

if [ ${#HITS[@]} -gt 0 ]; then
  for h in "${HITS[@]}"; do
    printf '%s\n' "$h"
  done
  echo "LEAK-SWEEP FAILED: ${#HITS[@]} hit(s). Mode=${MODE}."
  exit 1
fi
echo "LEAK-SWEEP CLEAN: 0 hits across ${#FILES[@]} file(s). Mode=${MODE}. PrivateTerms=${#PRIVATE_TERMS[@]}."
exit 0
