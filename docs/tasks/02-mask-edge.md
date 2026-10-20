# 02 Masks: soft edge, invert, grow or shrink (#153)

Who: Sonnet.

## What
Three new fields on a mask group: `feather` (pixels, 0 = hard), `invert` (keep what is outside), `grow` (pixels, negative shrinks). Defaults 0, false, 0.

## Where
- Add to `El` in `src/document/types.ts` and its defaults; check `src/document/serialize.ts` reads old files without them.
- Set through the existing `set_props` command. Add a test that old files open with the defaults.
- Drawing: `clipTo` in `src/canvas/render.ts` uses `ctx.clip()`, which is always hard. For feather and invert, draw the group's contents to an offscreen canvas, then draw the mask shape to another offscreen canvas with `ctx.filter = "blur(Npx)"`, and combine with `globalCompositeOperation = "destination-in"` (or `destination-out` for invert). Grow: stroke the shape with width `2 * grow` on top of the fill before blurring (shrink: `destination-out` stroke). Keep the plain `clip()` path when all three are default, so nothing gets slower.
- Export uses the same renderer, so it follows. Check `baseClip` in `src/video/scene.ts` skips masked clips (it does: `el.mask`).

## Done when
Soft edge, invert and grow show on the canvas and in export. Tests pass.

## Click list for him
Panel comes in task 03. Until then nothing to click.
