#!/usr/bin/env bash
# Sorts scratch/ the same way ref-tidy sorts ref/.
#
# scratch/ fills up with working images: renders an agent made to check its
# own work, crops, screenshots dropped in mid conversation. Those are session
# output. They are worth having on the night and worthless a week later, and
# when they sit in the root nobody can find the documents that matter.
#
# Documents, folders and design sources stay where they are. Images move into
# scratch/sessions/<date>/, dated by when the file was written.
#
# Dry run by default. Pass --apply to actually move anything. Never deletes.
set -u
cd "$(dirname "$0")/../.." || exit 1
SCRATCH="scratch"
LOG="scripts/scratch-tidy/log.txt"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Design sources that happen to be images. Add names here if any design source is an image.
KEEP=""

{
  [ $APPLY -eq 1 ] && echo "APPLYING" || echo "DRY RUN"
  echo "started $(date '+%Y-%m-%d %H:%M:%S')"
  echo "----------------------------------------"
} | tee "$LOG"

moved=0; kept=0
for f in "$SCRATCH"/*; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" = "README.md" ] && continue
  case "$base" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp) ;;
    *) kept=$((kept+1)); continue ;;
  esac
  case " $KEEP " in *" $base "*) kept=$((kept+1)); continue ;; esac

  day="$(date -r "$f" '+%Y-%m-%d')"
  dest="$SCRATCH/sessions/$day"
  # Lower case, spaces and dots to dashes, so the names stay typeable.
  clean="$(echo "$base" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9.]/-/g; s/--*/-/g; s/^-//; s/\.\([a-z]*\)$/.\1/')"
  {
    echo "  image       $base"
    echo "           -> sessions/$day/$clean"
  } | tee -a "$LOG"
  if [ $APPLY -eq 1 ]; then
    mkdir -p "$dest"
    mv "$f" "$dest/$clean"
  fi
  moved=$((moved+1))
done

{
  echo "----------------------------------------"
  echo "images: $moved    left alone: $kept"
  [ $APPLY -eq 0 ] && echo "" && echo "nothing moved. re-run with --apply when the plan looks right."
} | tee -a "$LOG"
exit 0
