#!/usr/bin/env bash
# Sort ref/ into references worth keeping and session screenshots that are not.
#
#   bash tidy.sh          dry run, prints the plan, changes nothing
#   bash tidy.sh --apply  actually moves files
#
# Nothing is ever deleted. Files are moved, so anything misfiled can be moved
# back. Screenshots are dated by their own filename or file timestamp.
#
#   ref/references/   keep. inspiration, style anchors, outside captures
#   ref/sessions/     throwaway. working screenshots and markups, by date
#
# Rule: only ref/references/ is durable. Never treat ref/sessions/ as memory,
# it is stale the moment the session ends.

set -uo pipefail
cd "$(dirname "$0")/../.."
REF="ref"
LOG="scripts/ref-tidy/log.txt"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

: > "$LOG"
note() { echo "$1" | tee -a "$LOG"; }

[ -d "$REF" ] || { note "FAIL  no ref/ folder here"; exit 1; }

note "$([ $APPLY -eq 1 ] && echo 'APPLYING' || echo 'DRY RUN, nothing will move')"
note "started $(date '+%Y-%m-%d %H:%M:%S')"
note "----------------------------------------"

run() { [ $APPLY -eq 1 ] && mkdir -p "$(dirname "$2")" && mv -n "$1" "$2"; }

moved=0; kept=0
while IFS= read -r f; do
  base="$(basename "$f")"
  ext="${base##*.}"

  # Duet screenshots: macOS default names, previously tagged session captures,
  # or session bug/test screenshots. Outside material goes to references.
  if [[ "$base" == Screenshot* || "$base" == screencapture-* ]]; then
    d="$(echo "$base" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"
    [ -z "$d" ] && d="$(date -r "$f" '+%Y-%m-%d' 2>/dev/null || echo 'undated')"
    slug="$(echo "$base" \
      | sed -E 's/^Screenshot //; s/^screencapture-//; s/ at /-/; s/\.[A-Za-z]+$//' \
      | tr 'A-Z ' 'a-z-' | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-|-$//g' | cut -c1-48)"
    dest="$REF/sessions/$d/${slug}.${ext}"
    note "  screenshot  $base"
    note "           -> ${dest#$REF/}"
    run "$f" "$dest"; moved=$((moved+1))
  elif [[ "$base" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-.*duet.*\.png$ ]]; then
    d="$(echo "$base" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}')"
    dest="$REF/sessions/$d/$base"
    note "  screenshot  $base"
    note "           -> ${dest#$REF/}"
    run "$f" "$dest"; moved=$((moved+1))
  elif [[ "$base" == antigravity-* || "$base" == blank-canvas-* || "$base" == look-at-* || "$base" == _renamed.txt ]]; then
    d="$(date -r "$f" '+%Y-%m-%d' 2>/dev/null || echo 'undated')"
    dest="$REF/sessions/$d/$base"
    note "  screenshot  $base"
    note "           -> ${dest#$REF/}"
    run "$f" "$dest"; moved=$((moved+1))
  else
    dest="$REF/references/$base"
    note "  reference   $base"
    run "$f" "$dest"; kept=$((kept+1))
  fi
done < <(find "$REF" -maxdepth 1 -type f ! -name '.DS_Store' ! -name 'README.md')

note "----------------------------------------"
note "screenshots: $moved    references: $kept"
[ $APPLY -eq 0 ] && note "" && note "nothing moved. re-run with --apply when the plan looks right."
exit 0
