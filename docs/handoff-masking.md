# Handoff: masking and roto for video

Written 20 Oct 2026, for a fresh session (Sonnet is fine for step 1). Read AGENTS.md first.

## Who and why

The creator edits client videos in his installed Duet (`/Applications/Duet.app`) and refuses to go back to Adobe. He needs After Effects level masking and a roto that works. Issues: #63 (mask a video and follow the subject), #70 (animate a shape's outline), #146 (masked pictures go black in an exported video).

## How to work with him

- Short replies, plain words, no recaps. One idea per line.
- Test only in Duet dev (`scripts/dev-duet.sh`, safe beside his app). Never touch his app or his projects.
- After each step: `npx tsc --noEmit`, `npm test`, commit on branch `work-in-project`, then build and install his app the safe way (see the memory note "Duet local app install"). Tell him to save, quit and reopen. No public release unless he asks.

## How masks work today

- A mask is a group with `mask: true`. Its bottom child is the shape (rect, ellipse, or closed pen path). `maskOf` in `src/document/geometry.ts`.
- The canvas clips hard to the shape: `clipTo` in `src/canvas/render.ts` (around line 229), used in `drawElement` (around line 300). No soft edge.
- Cmd Option M makes a mask (`maskSelection` in `src/ui/actions.ts`, command `make_mask` in `src/commands/index.ts`).
- Export draws each frame with the same renderer, except a fast path: `baseClip` in `src/video/scene.ts` (around line 238) reads the bottom full-frame clip straight from its file and draws only what lies over it.

## Step 1: masks that work on video (a few hours)

1. Fix #146. Steps to see it are in the issue: three masked pictures with their own times and a slow grow; only the last shows in the export, the others are black. Start by checking how export draws a masked group at a moment when it is not the last one (the `docAt` and `elAt` path in `src/document/time.ts`, and image loading during export).
2. Soft edge (feather), invert, and grow or shrink for a mask, as fields on the mask group, shown in the right panel when a mask is picked. Soft edge needs drawing through an offscreen canvas with a blur on the mask, since `ctx.clip()` is hard-edged. Add the fields to `El` in `src/document/types.ts` and to `serialize.ts` defaults, set through `set_props`, with a test.
3. Check that a pen-drawn mask over a video clip works on the canvas and in the export.

## Step 2: roto by hand (about a day)

A pen mask's points change over time. Moving points at another moment adds a key, and Duet blends the shape between keys while the clip plays. Today only x, y, width, height, opacity and rotation can change over time (`MOVING` in `src/document/types.ts`, `elAt` and `valueAt` in `src/document/time.ts`). Add the path's points as a property that changes over time, blending point by point (both keys need the same number of points). Point editing is in `src/canvas/nodes.ts`; changes made at a moment go through `settle` in `src/document/time.ts`. Show the keys in the timeline like the others.

## Step 3: automatic roto (a few days, Mac first)

One click cuts out a person in a clip, frame by frame, with the Mac's own person finder (Apple Vision person segmentation), run from Rust in `src-tauri`. Then a mask that follows a moving subject. Plan this one with him before building.
