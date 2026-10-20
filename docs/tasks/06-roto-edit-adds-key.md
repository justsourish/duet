# 06 Roto: moving a mask's points at a moment adds a key (#157)

Who: Sonnet. Needs 05.

## What
In Motion with the clock on a moment, editing a path's points (double-click into the path, drag points) on a path that has shape keys, or whose mask is in a scene, adds or updates a shape key at that moment. The first edit on a path with no keys makes two keys: the old shape at the scene start and the new one now.

## Where
Point editing: `src/canvas/nodes.ts`. Changes made at a moment: `runAtNow` and `dragPreviewDoc` in `src/state/store.ts`, `settle` in `src/document/time.ts`. Make `settle` handle shape keys the same way it handles number keys.

## Done when
Move points at 0s and at 2s; playing blends the shape. One Undo removes the last edit.

## Click list for him
1. Pen mask over a clip (task 04).
2. Playhead at 0. Double-click the mask, drag points around the person.
3. Playhead at 1s. Drag the points to follow. Play.
