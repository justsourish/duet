# 04 A pen mask over a video clip (#155)

Who: Sonnet. Small: mostly checking.

## What
Pen-draw a closed shape over a clip, pick both, Cmd Option M. Play and export. The clip shows only inside the shape.

## Where
`maskSelection` in `src/ui/actions.ts`, `make_mask` in `src/commands/index.ts`, `canMask` in `src/document/geometry.ts`. Check a video can be inside a mask group and that the group keeps the clip's time span in `src/ui/TimeStrip.tsx` (the group, not the clip, is now the scene's child).

## Done when
Canvas and export both show the clip through the shape, and the timeline still shows the clip's bar. Fix only what breaks.

## Click list for him
Draw a pen shape over a clip, Cmd Option M, play, export.
