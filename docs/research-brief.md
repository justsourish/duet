# Research brief: design tool feature inventory

Paste this whole file into Gemini. Ask it to answer in a single Markdown document.

## Context

I am building Duet, a free, open source desktop design app (Tauri, Windows and Mac). It is made by a designer for designers. Primary focus is UI/UX design, with graphic design and print layout later.

Key traits:
- Infinite canvas, Figma and Illustrator feel. Elements can sit anywhere, on a frame or off it. Very lightweight.
- A human and an AI agent use the same set of commands. The AI works through a local MCP server and terminal agent tools the user already has. No paid API keys.
- Designs are saved as plain JSON files. Local Git keeps history. No GitHub sync.
- Ships with design skills (spacing, type scale, contrast, mobile layouts) that the agent follows.
- I will build this with an AI coding agent, so favour libraries that are well documented.

## What I need

### 1. Feature inventory
A complete list of the features designers actually use in Figma, Illustrator, Affinity Designer and Penpot. Group them:
- Canvas and navigation (pan, zoom, rulers, guides, grids, snapping, artboards and frames)
- Objects (rectangle, ellipse, polygon, star, line, pen and bezier, pencil, text, images, groups)
- Fills and strokes (solid, gradients of every kind, image fills, stroke styles, dashes, caps, joins, multiple fills and strokes)
- Effects (shadows, blur, blend modes, opacity, masks)
- Shape editing (boolean operations, shape builder, path offset, outline stroke, node editing, corner radius)
- Layout (auto layout, constraints, grids, responsive resizing)
- Typography (fonts, variable fonts, text on path, OpenType features, text styles)
- Components and reuse (components, variants, styles, design tokens, libraries)
- Prototyping (links, flows, simple animation)
- Collaboration (comments, sharing, version history)
- Export (PNG, JPG, SVG, PDF, code, multiple scales, slices)
- Import (SVG, Figma files, Sketch files, images, fonts)
- Plugins and extensibility

### 2. Sort every feature into
- **Must have for version 1** (a designer could use the tool daily for UI work)
- **Should have soon**
- **Later**
- **Skip**

### 3. For each feature, tell me
- Rough build difficulty: easy, medium, hard
- Open source libraries or algorithms that already solve it, with licence (I want permissive licences only: MIT, Apache, BSD, MPL at most)
- Anything patented or legally risky, honestly and specifically (I know this is not legal advice)

### 4. Technical questions
- Best approach for the canvas renderer in a Tauri app that must be very lightweight: plain Canvas 2D, WebGL (PixiJS, regl), WebGPU, Skia compiled to WASM (CanvasKit), or something else. Compare speed, bundle size, text rendering quality, and how easy it is to build with.
- A good JSON document model for a design file that makes Git diffs readable and merges sane. Look at how Penpot, tldraw, Excalidraw and Figma's public format structure their data.
- How to keep images from bloating Git history (local only for now). Options such as storing assets by content hash outside Git, Git LFS, or a separate asset folder.
- How to expose an app's commands over MCP so that any agent can drive it, including which transport works best for a desktop app.
- How terminal agent tools (Claude Code, Gemini CLI, Antigravity and others) can be run non-interactively and streamed into a chat UI, and which have a stable machine-readable output mode.

### 5. AI-native opportunities
Which features become much better when a human and an AI share the same commands? Examples to think about: scaffolding a layout from a description, fixing spacing across a frame, generating variants, renaming layers, checking contrast, turning a sketch into components.

### 6. Existing competitors
A short list of open source and AI-first design tools already out there (for example Penpot, tldraw, Excalidraw, and newer AI design tools), what each does well, and where each falls short for a designer who wants hands-on control plus AI.

## Output format

Markdown, with tables where useful. Be specific and honest. Mark anything you are unsure about instead of guessing. Include links to sources.
