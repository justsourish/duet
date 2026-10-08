# Duet v1 scope and build plan

8 October 2026. Built from `principles.md` and `feature-inventory.md` (Gemini research). Where they disagree, this file wins for v1.

## The rule

Ship only what is real, and only what Sourish can use every day. A small tool that works beats a long list that does not.

## v1: what is in

**Canvas**
- Infinite canvas, smooth pan and zoom.
- Frames (screens) with clipping.
- Elements can sit anywhere, on a frame or off it.
- Smart snapping and alignment guides.

**Objects**
- Rectangle, ellipse, text, image.
- Groups.

**Styling**
- Solid fill, opacity.
- Stroke: width, inside, centre, outside.
- Corner radius, including individual corners.
- Drop shadow.
- Text: font, size, weight, line height, letter spacing, alignment.
- Local system fonts.

**Layout**
- Auto layout: direction, gap, padding, alignment, hug and fill.

**Panels**
- Layers and Skills tabs on the left.
- Plain design properties on the right.
- Floating AI chat with the Suggest, Ask first and Auto switch.
- History strip, human and AI changes marked differently.

**The core**
- One command layer used by both the GUI and the AI.
- Local MCP server and a small bridge program for agents.
- Chat runs the user's own agent tool in the background and streams the reply.
- Local Git checkpoint before every AI action.
- Skills: a few shipped, plus load, unload and create your own.

**Files**
- Flat JSON document, sorted keys, one record per element.
- Images stored by content hash, outside the JSON.
- Export PNG and SVG.
- Import SVG and images.

## v1.1: soon after

Components with overrides, colour and text styles, linear gradient, multiple fills, line and pen tool, boolean operations, masks, blur, PDF export, code export, rulers and grids, Figma file import.

## Later

Variants, prototyping, animation, other gradients, blend modes, text on path, plugin API, print and book layout.

## Skip

Real-time cloud multiplayer. Local first. Cloud storage comes later as its own decision.

## Decisions made

- **Git yes, GitHub no.** Design files and images stay local. No GitHub sync by default.
- **Undo for AI actions restores from a checkpoint as a new step.** Never `git reset --hard`, which would wipe hand edits made after the checkpoint.
- **Suggestions around a selection come in two kinds.** Instant local ones come from skill rules. AI ones come on request through a sparkle button. Auto mode can turn them on automatically.
- **Plain language in the UI.** Command names like `set_fill` stay inside the agent layer, never in front of designers.
- **Own icons, own colours, own code.** Nothing copied from other tools.

## Build plan

1. **Shell and canvas.** Tauri app on Mac and Windows. Infinite canvas, pan and zoom, frames, rectangle, ellipse, text. Renderer: start with plain Canvas 2D for speed of building. Move to PixiJS only if it gets slow.
2. **Document and commands.** The JSON document. The command layer. Every GUI action goes through it. Save and open projects as single `.duet` files (a zip with the design, pictures and history inside).
3. **Styling and layout.** Fill, stroke, radius, shadow, text styling, auto layout with Taffy.
4. **History.** Local Git. Checkpoint per action. The history strip with restore.
5. **AI.** MCP server and bridge. Chat panel running the user's agent tool. Permission levels. Skills tab.
6. **Import, export and polish.** SVG and image import, PNG and SVG export, snapping, daily-use fixes.
7. **Public release.** Trim the README, make the repo public, publish unsigned Mac and Windows builds, record install tutorials.

## To verify before we rely on them

- The libraries Gemini named: repo links, licences, and that each still works as described.
- The exact non-interactive flags for each agent tool. Test them for real in step 5.
- The Figma patent on arranging objects and spacing. Avoid copying their on-canvas drag handles regardless.
- Font licensing. Bundle only open fonts. Use installed system fonts at runtime.

## Open questions

- Skills format and where skills live on disk. Not decided yet.
- Whether projects are one folder each or one file each.
- Product name. Duet is a working name.

## Built so far (8 October 2026)

Canvas, frames, rectangle, ellipse, text. Layers with drag and drop. Fill, linear gradient, stroke, corner radius, one shadow, opacity, text size. Copy, paste, duplicate. PNG and SVG export. Prototype links and Present mode. Projects as `.duet` folders with autosave. Saved history in two lanes with named versions. AI chat for Claude Code and Antigravity, three permission levels, skills (shipped, written, imported).

Still to do from the v1 list: auto layout, image import, snapping to spacing, and Antigravity, Codex and OpenCode support.
