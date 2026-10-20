# 05 Roto: a mask's shape changes over time (#156)

Who: Sonnet. The biggest one. Keep it to the data and the blending.

## What
A pen path's points can have keys. Between two keys the shape blends point by point.

## Where
- Things that change over time: `MOVING` and `Key` in `src/document/types.ts`; `valueAt`, `elAt`, `poseAt`, `settle` in `src/document/time.ts`.
- Path points: `src/document/path.ts` (`toAbs`, `fromAbs`). Read how a path stores its points before choosing.
- Add a separate list of shape keys on the element (e.g. `shapeKeys: { t, points, ease }[]`) rather than forcing points into the number-only `keys`. `elAt` blends the points of the two keys around `t` with the same curve as other keys. Keys with different point counts: hold the earlier shape until the next key.
- A command `set_shape_key` (add or replace a key at a time) and `remove_shape_key`, with tests. Old files open with no shape keys.

## Done when
A test shows a path at t between two keys has its points halfway. Export matches the canvas.

## Click list for him
Nothing yet. Task 06 makes it usable.
