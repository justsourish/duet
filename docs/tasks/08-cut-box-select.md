# 08 Box-select clips in the Cut tab (#159)

Who: Antigravity.

## What
In the timeline, Cut view, drag on empty lane space (not on a bar) to draw a box. Every clip bar it touches is picked. Shift keeps what was already picked. A click without a drag still moves the playhead.

## Where
`src/ui/TimeStrip.tsx`: `scrub` (pointer down on a lane), `renderBar`, `select` from the store. Draw the box as an absolutely placed div inside `.time-lanes`, styled in `src/styles.css` with `var(--accent)`.

## Click list for him
Cut view. Drag a box across three clips. Drag one: all three move.
