# 01 Masked pictures go black in an exported video (#146)

Who: Sonnet.

## See it
A 10 second scene with three pictures, each masked by a rounded rectangle (Cmd Option M), shown 0 to 3s, 3 to 6s, 6 to 9s, each slowly growing. Export: the first two are black, the last shows.

## Where
- Export draws each frame with the canvas renderer: `exportScene` in `src/video/scene.ts`.
- Masks: `maskOf` in `src/document/geometry.ts`, `clipTo` and `drawElement` in `src/canvas/render.ts` (around lines 229 and 300).
- Moments: `docAt` and `elAt` in `src/document/time.ts`.

## Likely
A picture that is not on screen at the first frame may not be loaded when its turn comes, or the mask group's time span hides its children. Find out by reading, not guessing. Write a test in `src/__tests__/core.test.ts` with `docAt` if the cause is in time.

## Done when
Every masked picture shows in the export as on the canvas.

## Click list for him
Make the scene above, export, play the file.
