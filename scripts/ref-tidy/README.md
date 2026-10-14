# ref-tidy

Sorts `ref/` into two kinds of thing, because they have different lifespans.

    bash tidy.sh          dry run, prints the plan, changes nothing
    bash tidy.sh --apply  moves the files

**Nothing is ever deleted.** Files are moved, so a mistake is one `mv` away
from being undone.

## The two kinds

    ref/references/   durable. style anchors, inspiration, outside captures
    ref/sessions/     disposable. working screenshots and markups, by date

## The rule that matters

**Only `ref/references/` is memory.** A screenshot in `ref/sessions/` shows
what the app looked like at one moment on one night. Reading it later as if it
were current is how you end up solving a problem that was fixed three rounds ago.

Session folders get deleted when a milestone closes. References do not.

## How it decides

- Screenshots of Duet (macOS `Screenshot...`, captures with dates or app tags)
  move to `ref/sessions/<date>/`.
- Outside material (Pinterest pins, inspiration captures, competitor references,
  sample media) moves to `ref/references/`.
- Nothing is deleted. Only moved.
