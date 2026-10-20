# 07 Roto: shape keys show in the timeline (#158)

Who: Antigravity. Needs 05.

## What
A path with shape keys shows a "Shape" row under it in the timeline (Layers view), with a diamond at each key, like the Position and Size rows. Drag a diamond to move the key, Delete removes it.

## Where
`renderKindRows` and `dragMark` in `src/ui/TimeStrip.tsx`. Use the commands from task 05, plus a `move_shape_key` command if 05 did not add one (ask Sonnet to add it; Antigravity must not touch `src/commands/` or `src/document/`).

## Click list for him
Open the arrow next to the mask in the timeline. Drag a diamond. Press Delete on one.
