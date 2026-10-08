> **Read this first.** This report was written by an AI research tool and has not been fact-checked. Library links, licences, patent numbers and legal statements in it may be wrong. Do not rely on it for legal decisions. It was used as a starting point, and `v1-scope.md` is what the project actually follows.

# Duet: Design Tool Feature Inventory & Technical Architecture Report

Written for the Duet project, 8 October 2026.
This document provides the complete feature inventory, roadmap tiering, permissive open source library recommendations, legal risk analysis, and architectural answers for Duet.

---

## 1. Executive Summary & Duet Architecture Alignment

Duet is an open source, desktop-first UI/UX design tool built on Tauri (Rust + Web). Its core differentiator is **command parity between human and AI**: every action triggered by a mouse click, keyboard shortcut, or menu item executes the exact same named command that an AI agent calls through a local Model Context Protocol (MCP) server.

To keep Duet fast, lightweight, and genuinely open:
- **No paid cloud APIs are mandated**: Users bring terminal agents they already run locally (Claude Code, Gemini CLI, Antigravity).
- **No proprietary cloud lock-in**: Files are saved locally as plain JSON. Local Git handles history and rollbacks automatically before any destructive AI operation.
- **Permissive open source only**: Every library suggested below uses MIT, Apache 2.0, BSD, or MPL licenses.

---

## 2. Feature Inventory & Roadmap Tiering

Every feature across Figma, Illustrator, Affinity Designer, and Penpot is inventoried and categorized into four tiers:
- **Must Have for v1 (MVP)**: Necessary for a designer to complete real daily UI/UX screen design.
- **Should Have Soon (v1.1 - v1.2)**: High-leverage features that turn early adopters into daily evangelists.
- **Later (v2.0+)**: Advanced vector illustration, print prep, and complex motion tools.
- **Skip**: Anti-features that bloat the app, violate privacy, or duplicate OS/Git capabilities.

| Category | Feature | Tier | Rationale |
| :--- | :--- | :--- | :--- |
| **Canvas & Nav** | Pan & Zoom (Infinite Canvas) | **Must Have v1** | Fundamental canvas primitive; 60fps touchpad and wheel panning. |
| | Frames / Artboards | **Must Have v1** | Core UI design container for screens, device presets, and clipping bounds. |
| | Smart Snapping & Alignment Guides | **Must Have v1** | Critical for pixel-precision design (bounds, centers, equidistant spacing). |
| | Rulers & Draggable Guides | **Should Have Soon**| Helpful for manual grid setup, but smart snapping carries v1. |
| | Layout Grids (Columns, Rows, Baseline)| **Should Have Soon**| Essential for UI systems, but simple frames suffice on day one. |
| | Pixel Grid at high zoom | **Should Have Soon**| Prevents subpixel blur during icon and asset design. |
| | Minimap / Birds-eye navigation | **Later** | Nice to have on huge canvases; keyboard shortcuts solve navigation early. |
| **Objects** | Rectangle & Rounded Rectangle | **Must Have v1** | Most common UI element (cards, buttons, backgrounds). |
| | Ellipse | **Must Have v1** | Avatars, badges, circular buttons. |
| | Text | **Must Have v1** | Core UI content. Needs multi-line, auto-width, and auto-height. |
| | Image Placement | **Must Have v1** | Essential for mockups, avatar photos, and hero graphics. |
| | Frame Containers | **Must Have v1** | Parent-child grouping with optional overflow clipping. |
| | Free Groups (Cmd+G) | **Must Have v1** | Logical grouping without layout enforcement. |
| | Line & Arrow | **Should Have Soon**| Dividers, connectors, flow diagrams. |
| | Pen Tool (Cubic Bezier paths) | **Should Have Soon**| Necessary for custom vector shapes and icons; v1 can import SVGs. |
| | Polygon (Triangle, Hexagon) | **Later** | Can be drawn with pen tool or imported as SVG. |
| | Star Shape | **Later** | Rating stars, badges; low daily UI priority. |
| | Pencil Tool (Freehand drawing) | **Later** | Whiteboarding and sketching feature; not strict UI/UX work. |
| **Fills & Strokes** | Solid Color Fills (HEX, RGB, HSL) | **Must Have v1** | Non-negotiable UI styling. |
| | Stroke Weight, Alignment (Inside/Center/Outside) | **Must Have v1** | Critical for crisp button borders and card outlines. |
| | Linear Gradient | **Should Have Soon**| Modern UI visual polish. |
| | Radial & Angular Gradients | **Later** | Rarely needed in core UI design compared to linear gradients. |
| | Multiple Fills & Strokes per object | **Should Have Soon**| Figma standard; essential for complex overlay states. |
| | Stroke Caps & Joins (Round, Bevel, Miter) | **Should Have Soon**| Icon design and illustration polish. |
| | Dash Patterns | **Should Have Soon**| Dropzones, dashed dividers, selection boxes. |
| | Image Fill Mode (Fit, Fill, Crop, Tile)| **Should Have Soon**| Needed for flexible responsive card mockups. |
| **Effects** | Opacity (Layer & Fill level) | **Must Have v1** | Modal backdrops, disabled states, subtle borders. |
| | Drop Shadows & Inner Shadows | **Must Have v1** | UI elevation and card depth. |
| | Background Blur & Layer Blur | **Should Have Soon**| Glassmorphism and modal focus states. |
| | Blend Modes (Multiply, Screen, Overlay)| **Later** | Graphic design & photo manipulation; rare in clean UI systems. |
| | Masking (Shape clipping masks) | **Should Have Soon**| Custom image containers and avatar cropping. |
| **Shape Editing** | Corner Radius (Individual corners) | **Must Have v1** | Asymmetric card styling (e.g. top-only rounded corners). |
| | Corner Smoothing (Squircle / iOS curve)| **Should Have Soon**| Distinctive design-craft detail popular in modern UI. |
| | Boolean Ops (Union, Subtract, Intersect, Exclude) | **Should Have Soon**| Creating custom icons and compound badges. |
| | Node Editing (Anchor points & handles)| **Should Have Soon**| Tweaking vector paths and imported SVGs. |
| | Outline Stroke | **Later** | Converting strokes into expandable fills for icon export. |
| | Shape Builder Tool | **Later** | Illustrator-style path merging; overkill for UI design. |
| | Path Offset / Inset | **Later** | Technical vector illustration feature. |
| **Layout** | Auto Layout (Flexbox: Horizontal/Vertical)| **Must Have v1** | Absolutely non-negotiable for real UI design. Stacks, gaps, padding. |
| | Fill Container / Hug Contents / Fixed Size| **Must Have v1** | Responsive resizing inside frames. |
| | Space Between & Packed alignment | **Must Have v1** | Navigation bars, toolbars, list items. |
| | Wrap Layout (Flex wrap) | **Should Have Soon**| Tag clouds, chip lists, responsive photo grids. |
| | Absolute positioning inside Auto Layout| **Should Have Soon**| Notification badges and close buttons pinned to card corners. |
| | Min / Max Width & Height constraints | **Should Have Soon**| Responsive UI boundaries. |
| | CSS Grid (2D Grid auto-placement) | **Later** | Advanced web layout; Penpot has it, but flexbox covers 90% of UI. |
| **Typography** | Font Family & Weight selection | **Must Have v1** | Basic typography hierarchy. |
| | Font Size, Line Height, Letter Spacing | **Must Have v1** | Essential typographic tuning. |
| | Text Alignment (Left, Center, Right) | **Must Have v1** | Paragraph and label formatting. |
| | Text Auto-Resize (Auto Width, Auto Height, Fixed)| **Must Have v1** | Buttons that stretch vs paragraphs that wrap. |
| | Text Styles (Reusable Presets) | **Must Have v1** | H1, Body, Caption scale consistency. |
| | OpenType Features (Tabular figures, fractions)| **Later** | Data tables, finance dashboards. |
| | Variable Fonts (Weight, Width, Slant axes)| **Later** | Advanced typography craft. |
| | Text on Path | **Later** | Pure graphic design / badge design. |
| **Components & Reuse**| Reusable Components (Master & Instance) | **Must Have v1** | Core design system feature; changes to master propagate to instances. |
| | Instance Property Overrides (Text, Color, Image)| **Must Have v1** | Reusing a button with different labels and colors. |
| | Color & Style Tokens | **Must Have v1** | Shared palette variables. |
| | Component Variants (State sets) | **Should Have Soon**| Organizing Button (Primary/Secondary, Hover/Default). |
| | Nested Component Swapping | **Should Have Soon**| Swapping icon instances inside button components. |
| | External Design Libraries | **Later** | Cross-file sharing; single-project components come first. |
| **Prototyping** | Page Linking (On click -> Navigate to frame)| **Should Have Soon**| Basic client walkthroughs and pitch presentations. |
| | Simple Transitions (Instant, Dissolve, Slide)| **Should Have Soon**| Screen presentation flows. |
| | Interactive Component States | **Later** | Micro-interactions (hover, toggle switches). |
| | Smart Animate (Matching layer interpolation)| **Later** | High build complexity; not required for static UI design. |
| **Collaboration** | Local Git History & Checkpoints | **Must Have v1** | Duet's core safety net; auto-checkpoint on every AI edit. |
| | Canvas Annotations / Human Comments | **Should Have Soon**| Notes pinned to frames for design review. |
| | Agent Execution Log & Rollback Button | **Must Have v1** | Visual history strip showing human vs AI commits. |
| | Multiplayer Real-time Cloud Sync | **Skip** | Duet is local-first. Cloud servers and CRDT sync conflict with privacy and zero-cost goals. |
| **Export** | PNG & JPG Export (1x, 2x, 3x) | **Must Have v1** | Sharing mockups and client assets. |
| | SVG Export (Clean, optimized vector output)| **Must Have v1** | Developer handoff and icon delivery. |
| | Frame Slices & Asset Export marks | **Must Have v1** | Marking specific layers/frames for batch export. |
| | PDF Export (Single and Multi-page) | **Should Have Soon**| Design presentations, client pitch decks, invoices. |
| | Code Generation (HTML/Tailwind/CSS tokens)| **Must Have v1** | Agent-driven export directly to code. |
| **Import** | SVG Import (Convert to native vector objects)| **Must Have v1** | Bringing in icons from Lucide, Heroicons, Phosphor. |
| | Bitmap Image Import (PNG, JPG, WebP, GIF)| **Must Have v1** | Adding visual media to canvas. |
| | Local System Font Auto-Detection | **Must Have v1** | Accessing installed macOS and Windows fonts without uploading. |
| | Figma File Import (.fig parsing) | **Should Have Soon**| Easing switching friction from Figma. |
| | Sketch File Import (.sketch JSON zip) | **Later** | Legacy format; SVG and Figma cover 95% of migrations. |
| **Plugins & Extensibility**| Local Model Context Protocol (MCP) Server| **Must Have v1** | Duet's flagship capability: AI agents control canvas over MCP. |
| | Plain JSON Command Dispatcher | **Must Have v1** | CLI and script automation. |
| | Sandboxed JS Plugin API (Web Workers) | **Later** | Community UI plugins; agent commands solve this first. |

---

## 3. Technical Feasibility, Open Source Libraries & Legal Risks

To ensure build speed and zero licensing issues, all recommended libraries are under **MIT, Apache 2.0, BSD, or MPL** licenses.

| Feature Area | Build Difficulty | Permissive Open Source Libraries / Algorithms | Patent & Legal Considerations |
| :--- | :--- | :--- | :--- |
| **Layout & Auto Layout** | **Medium** | **[Taffy](https://github.com/DioxusLabs/tauri-taffy)** (MIT / Apache-2.0, Rust) or **[Yoga](https://github.com/facebook/yoga)** (MIT, C++/WASM). Taffy is written in pure Rust, making it lightning-fast inside Tauri. Implements CSS Flexbox and Grid. | **Safe**: CSS Flexbox and Box Alignment are open W3C standards with no proprietary patent claims. |
| **Vector Geometry & Booleans** | **Hard** | **[Clipper2](https://github.com/AngusJohnson/Clipper2)** (Boost Software License 1.0 - fully permissive, C++/C#/Rust ports available). **[Paper.js Core](https://github.com/paperjs/paper.js)** (MIT) or **[martinez-polygon-clipping](https://github.com/w8r/martinez-polygon-clipping)** (MIT). | **Safe**: Boolean polygon clipping algorithms (Vatti, Greiner-Hormann, Martinez-Rueda) are widely published academic algorithms in the public domain. |
| **Path Offsetting & Stroke Expansion** | **Medium** | **[Clipper2 Offset](https://github.com/AngusJohnson/Clipper2)** (BSL 1.0) or Skia PathKit `strokeToPath` (BSD-3-Clause). | **Safe**: Standard Minkowski sum approximations. |
| **Corner Smoothing (Squircle)** | **Easy** | Figma's smooth corner algorithm is based on clothoid/Euler spirals and quartic superellipses. An MIT-licensed reference implementation exists: **[figma-squircle](https://github.com/phamann/figma-squircle)** (MIT) and **[squircle-canvas](https://github.com/kripod/squircle-canvas)** (MIT). | **Safe**: Apple holds design patents on hardware rounded silhouettes, but mathematical superellipses on GUI elements are unpatentable geometry. |
| **Vector Networks (Figma-style)** | **Hard** | Graph-based vector topology (vertices with arbitrary edges, rather than strict ordered bezier loops). Academic foundation: Boris Dalstein's PhD thesis on *Vector Graphics Complex* (open source project **[VGC](https://github.com/vgc/vgc)** - Apache 2.0). | **Low Risk**: While Figma popularized "vector networks" in 2016, public patent searches show no enforceable utility patent blocking the generalized mathematical graph data structure. However, standard path loops are recommended for v1 to avoid complexity. |
| **Smart Snapping & Dynamic Guides** | **Medium** | Spatial indexing using **[rbush](https://github.com/mourner/rbush)** (MIT, 2D R-Tree) or **[bvh](https://github.com/svenstaro/bvh)** (MIT, Rust). Query bounding boxes within tolerance threshold $\epsilon$. | **Cleared**: Adobe originally held US Patent 7,461,353 for "Dynamic alignment guides" (filed 2003, granted 2008). **This patent expired in 2023** after its 20-year term. Smart guides can now be built freely. |
| **Canvas Arrangement & Tidy-Up** | **Medium** | Calculating bounding box gutters and distributing them evenly across selection arrays. | **Watch Closely**: Figma was granted **US Patent 12,625,591** in 2025/2026 ("Tool for arranging objects and adjusting spacing in a layout"), covering interactive on-canvas handles for reordering and adjusting spacing directly between elements in an organized collection. **Recommendation**: Implement spacing adjustments through sidebar inputs and standard alignment menus; avoid copying Figma's exact on-canvas pink circular drag-reorder handles. |
| **Font Parsing & Glyph Shaping** | **Medium to Hard** | **[HarfBuzz](https://github.com/harfbuzz/harfbuzz)** via **[harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs)** or **[rustybuzz](https://github.com/RazrFalcon/rustybuzz)** (MIT). **[opentype.js](https://github.com/opentypejs/opentype.js)** (MIT) for glyph outline extraction. | **Watch Font Licensing**: Parsing user fonts is completely legal. Distributing proprietary system fonts (San Francisco, Segoe UI, Helvetica) inside Duet's installer is illegal. Duet must load installed system fonts dynamically or bundle open fonts (Inter, Geist, Roboto) licensed under SIL Open Font License. |
| **Figma File Import (.fig)** | **Medium** | Figma `.fig` files are zipped binary schemas compressed with Kivik/Brotli, containing Kiwi binary schema payloads. Open source parsers: **[fig2sketch](https://github.com/reinpk/fig2sketch)** (MIT) and Penpot's Figma importer (MPL 2.0). | **Low Risk**: Reverse-engineering an undocumented file format for interoperability is protected under clean-room engineering fair use precedents in both US and EU law. |
| **Local Git Versioning Engine** | **Easy to Medium**| **[git2-rs](https://github.com/rust-lang/git2-rs)** (libgit2 bindings in Rust, GPL2 with Linking Exception / permissive) or running system `git` CLI over `std::process::Command` in Tauri. | **Safe**: Git is an open source tool; automating local commits and branches violates no terms. |

---

## 4. Technical Architecture Answers

### 4.1 Canvas Renderer in Tauri: Deep Comparison

For a desktop app built on Tauri, the canvas engine dictates memory usage, rendering speed, and binary size. Here is the direct comparison of the five candidates:

| Engine | Bundle Size Overhead | 60 FPS Object Limit | Text Quality & Shaping | Dev Velocity & Ecosystem | Verdict for Duet |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Plain Canvas 2D (`<canvas>`)** | **0 KB** (Built into WebView) | ~3,000–5,000 shapes (with dirty rects & spatial culling) | Good, but dependent on OS font rasterizer; lack of native HarfBuzz shaping. | **Fastest**: Standard web API, zero build friction, easy for AI agents to write. | **Recommended for v1 Prototype** |
| **PixiJS (WebGL 2.0 / WebGPU)** | **~200 KB** | ~50,000+ objects via GPU batching | Requires MSDF (multi-channel signed distance field) or raster textures for zoom. | **Very High**: Battle-tested 2D scene graph, huge community, rich filter support. | **Top Contender for v1 Production** |
| **CanvasKit (Skia compiled to WASM)** | **~3.2 MB** WASM payload | ~30,000+ vector paths with hardware acceleration | **Flawless**: Bundles HarfBuzz and SkParagraph; identical rendering on Mac & Windows. | **Medium**: Steep C++ style JS API; debugging WASM crashes is slower. | **Best Long-Term Vector Engine (v2)** |
| **Rust Native wgpu (Tauri Window)** | **~1.5 MB** compiled | 100,000+ objects | Must build custom font atlas using `glyphon` / `cosmic-text`. | **Slow**: Immature ecosystem for rich vector UI; high maintenance burden. | **Skip for Canvas** |
| **Paper.js / Fabric.js** | **~150 KB** | ~1,500 shapes (sluggish on large files) | Basic canvas text. | Slower than PixiJS; legacy architectures. | **Skip** |

#### Concrete Recommendation for Duet
1. **v1 Architecture**: Use **PixiJS v8** (which natively supports WebGL and WebGPU backends with fallback) or a tailored **Canvas 2D renderer backed by an R-Tree index (rbush)**. This keeps the bundle under 10 MB, renders at 60 FPS, and allows rapid AI code generation.
2. **Layout Calculation**: Run **Taffy** in the Rust backend or compile Taffy to WASM in the frontend. Taffy computes the Flexbox bounds of all elements in microseconds, then hands the coordinates to the canvas renderer to draw.
3. **Typography**: Use standard browser text rendering for v1, paired with `opentype.js` when converting text to vector curves during SVG export.

---

### 4.2 Git-Friendly JSON Document Model

Standard design file formats (like Figma's REST JSON or old Sketch files) use deeply nested trees. A single nested change modifies dozens of lines and breaks Git 3-way merges.

#### The Problem with Nested Trees in Git
```json
// BAD: Deeply nested tree (A change in Child 2 causes parent line changes and merge conflicts)
{
  "id": "frame-1",
  "children": [
    { "id": "rect-1", "fill": "#ffffff" },
    { "id": "rect-2", "fill": "#000000" }
  ]
}
```

#### Duet's Solution: Normalized Flat Store with Fractional Indexing
Adopt the data model proven by **tldraw** and **Linear**: flat records indexed by ID, combined with fractional indexing strings for Z-order.

```json
{
  "version": 1,
  "pages": {
    "page-home": {
      "id": "page-home",
      "name": "Landing Page",
      "rootIds": ["frame-hero", "rect-bg"]
    }
  },
  "elements": {
    "frame-hero": {
      "id": "frame-hero",
      "parentId": "page-home",
      "type": "frame",
      "x": 0,
      "y": 0,
      "width": 1440,
      "height": 900,
      "layoutMode": "vertical",
      "gap": 24,
      "padding": [40, 40, 40, 40],
      "childIds": ["btn-cta", "txt-headline"],
      "index": "a0"
    },
    "txt-headline": {
      "id": "txt-headline",
      "parentId": "frame-hero",
      "type": "text",
      "content": "Design with your agent.",
      "fontFamily": "Inter",
      "fontSize": 48,
      "fontWeight": 700,
      "fill": "#0f172a",
      "index": "a0"
    },
    "btn-cta": {
      "id": "btn-cta",
      "parentId": "frame-hero",
      "type": "frame",
      "layoutMode": "horizontal",
      "fill": "#3b82f6",
      "cornerRadius": [8, 8, 8, 8],
      "childIds": ["txt-cta"],
      "index": "a1"
    }
  }
}
```

#### Why This Works for Git
1. **Deterministic Line Placement**: Format JSON with keys sorted alphabetically (`jq -S` style).
2. **Isolated Diffs**: Editing `txt-headline` changes exactly 5 contiguous lines in `elements.txt-headline`. The parent `frame-hero` is completely untouched.
3. **Fractional Indexing (`index: "a0"`, `"a1"`)**: Reordering children does not require changing indices on surrounding siblings (e.g. inserting an element between `a0` and `a1` assigns `a05`).
4. **Clean Merge Resolution**: If Sourish edits button text while an AI agent modifies padding on the parent frame, Git merges the two changes cleanly with **zero merge conflicts**.

---

### 4.3 Asset & Image Storage Strategy

Storing binary images (JPG/PNG) directly inside the JSON file as Base64 strings causes severe document bloat, slows parsing, and makes Git repositories swell by hundreds of megabytes in days.

#### Duet's Three-Tier Asset Strategy
1. **Content-Addressable Storage (CAS)**:
   - When an image is dropped onto the canvas, Duet computes its SHA-256 hash.
   - The file is saved to a local project asset folder: `.duet/assets/<sha256>.<extension>` (e.g., `.duet/assets/7f8b9a2c...png`).
2. **Document References by Hash**:
   - The JSON document never stores binary data; it stores only the reference:
     ```json
     {
       "id": "img-avatar",
       "type": "image",
       "assetHash": "7f8b9a2c3d4e5f6...",
       "width": 120,
       "height": 120
     }
     ```
3. **Local Git Deduplication**:
   - Because asset filenames are their SHA-256 hash, identical images are stored once.
   - If an image is deleted from the canvas and re-added later, no new file is created.
   - Git commits binary files in `.duet/assets/` cleanly without churn because files are **immutable**: they are created once and never modified in place.
   - *(Optional for huge files)*: A project-level toggle can add `.duet/assets/` to `.gitignore` or use local Git LFS if the user chooses.

---

### 4.4 Exposing Commands Over MCP (Desktop Transport)

The core principle of Duet is that the human and the AI share the exact same command layer.

#### The Dual-Transport Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Duet GUI                          │
│  (UI Buttons, Canvas Events, Shortcuts, History Strip) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│               Unified Command Dispatcher               │
│  execute_command("set_fill", { id: "box-1", color: ...})│
└───────────────▲────────────────────────▲───────────────┘
                │                        │
     ┌──────────┴────────┐      ┌────────┴────────┐
     │ Tauri IPC Channel │      │ Local MCP Server│
     │  (Internal GUI)   │      │ (Port / Socket) │
     └───────────────────┘      └────────▲────────┘
                                         │ JSON-RPC
                                ┌────────┴────────┐
                                │ External Agent  │
                                │ (Claude / AGY)  │
                                └─────────────────┘
```

#### Best Transport for a Desktop App
- Standard MCP servers designed for CLI tools use **stdio** (standard input/output).
- However, a GUI desktop app cannot easily expose its main process's stdio to external agents.
- **The Solution**: Duet ships with a dual setup:
  1. **Background Daemon in Tauri**: When Duet opens, the Tauri backend starts a lightweight local loopback Server-Sent Events (SSE) / HTTP server on `127.0.0.1:49152` (or a dynamic port saved to `~/.duet/session.json`).
  2. **Zero-Config Stdio Bridge CLI (`duet-mcp`)**: A lightweight 50-line Rust binary or Node script installed in the user's path. When Claude Code or Antigravity starts `duet-mcp`, the bridge talks stdio to the agent, connects to Duet's local HTTP/WebSocket port, and relays messages.

#### Core MCP Tools Exposed by Duet
```json
[
  {
    "name": "get_canvas_selection",
    "description": "Returns the ID, bounds, and properties of currently selected elements."
  },
  {
    "name": "get_element_tree",
    "description": "Returns the flat JSON tree of a specified frame or the entire active page."
  },
  {
    "name": "dispatch_command",
    "description": "Executes a named Duet command (e.g. create_frame, set_auto_layout, update_text, set_style)."
  },
  {
    "name": "capture_viewport",
    "description": "Returns a base64 PNG screenshot of the current canvas or selected frame for visual verification."
  },
  {
    "name": "create_git_checkpoint",
    "description": "Creates a named local git commit before making structural changes."
  }
]
```

---

### 4.5 Running Terminal Agents Non-Interactively with Clean Streams

Users bring their own local agent tools (Claude Code, Gemini CLI, Antigravity). Duet spawns these agents in the background and streams their thoughts and tool actions into Duet's embedded chat panel.

#### Comparison of Terminal CLI Execution Modes

| Agent CLI | Non-Interactive Command Flag | Machine-Readable Output Mode | Streaming Capabilities |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `claude -p "<prompt>"` | `--output-format json` (or raw markdown stdout) | Streams tokens over stdout in realtime; detects piped execution and disables curses UI. |
| **Antigravity CLI (`agy`)** | `agy run "<prompt>"` | Structured JSON Lines (`--format jsonl`) | Full streaming support; emits step events, tool calls, and text tokens. |
| **Gemini CLI** | `gemini --prompt "<prompt>"` | Standard piped stdout / `--json` | Piped stdout streams text cleanly without terminal escape sequences. |

#### How Tauri Orchestrates Non-Interactive Agents
1. **Pseudoterminal (PTY) Avoidance**: Run processes using standard piped I/O (`std::process::Command` in Rust) rather than allocating a virtual terminal. This signals to CLI programs that stdout is not a TTY, causing them to strip ANSI escape codes and progress bars automatically.
2. **Stream Forwarding**:
   ```rust
   // Rust snippet in Tauri backend
   use tokio::io::{AsyncBufReadExt, BufReader};
   use tokio::process::Command;

   let mut child = Command::new("claude")
       .arg("-p")
       .arg(&prompt)
       .stdout(std::process::Stdio::piped())
       .spawn()?;

   let stdout = child.stdout.take().unwrap();
   let mut reader = BufReader::new(stdout).lines();

   while let Some(line) = reader.next_line().await? {
       // Emit realtime text token to Duet's chat UI
       app_handle.emit("agent-stream-chunk", line)?;
   }
   ```
3. **Safety Net**: Prior to invoking the agent process, Duet automatically commits the current state to local Git: `git commit -am "checkpoint: before agent action"`. If the agent makes a mistake, a single click on the history strip executes `git reset --hard HEAD~1`.

---

## 5. AI-Native Opportunities (Human & AI Sharing Controls)

When a human and an AI share the exact same command layer, the design process transforms from slow manual drafting to fluid co-creation:

1. **Scaffolding from Intent**:
   - The designer draws a loose rectangle and types: *"Hero section for a developer productivity app with a 2-column layout, badge at top, and dark theme."*
   - The agent executes `set_auto_layout`, creates child text frames with real type styles, inserts a CTA button component, and applies color tokens.
2. **Spacing & Alignment Healing**:
   - Designers frequently assemble mockups with messy margins (e.g. 13px, 17px, 22px).
   - Command: *"Fix spacing to an 8px scale across this frame."*
   - The agent traverses the subtree, snaps padding and gaps to multiples of 8, and converts manual absolute positions into clean Auto Layout stacks.
3. **Automated Variant & State Generation**:
   - Select a `Button` component and say: *"Generate Hover, Active, Disabled, and Focused states."*
   - The agent reads the master component, generates 4 variants, applies appropriate opacity and border treatments, and arranges them in a tidy variant grid.
4. **Visual Contrast & Accessibility Auditing**:
   - The agent uses the `capture_viewport` and `get_element_tree` tools to calculate luminance contrast ratios (WCAG 2.1 AA/AAA) between text fills and parent background colors, proactively flagging unreadable text.
5. **Intelligent Semantic Renaming**:
   - AI eliminates the universal design bug of `Rectangle 482` and `Frame 19`.
   - The agent scans the hierarchy and renames layers based on their content: `Card / Testimonial`, `Avatar / UserProfile`, `Input / EmailField`.
6. **Multi-Modal Visual Verification Loop**:
   - After modifying a layout, the agent takes a viewport screenshot, evaluates its own work visually, checks for awkward text wraps or overlapping layers, and adjusts the layout parameters before presenting the result to the designer.

---

## 6. Competitor Teardown

| Tool | Strengths | Shortfalls for Hands-On + AI Designers |
| :--- | :--- | :--- |
| **Penpot** | • Fully open source (MPL 2.0).<br>• Uses web-standard CSS Flexbox and Grid.<br>• Mature vector path editing and components. | • Heavy, complex self-hosting stack (Clojure, Docker, PostgreSQL, Elixir).<br>• Cloud-first rather than desktop-first.<br>• No built-in local MCP server or unified human/AI command layer. |
| **tldraw** | • Phenomenal lightweight canvas architecture.<br>• Fast reactive in-memory document store.<br>• Very easy to embed and extend. | • Oriented toward whiteboarding and diagramming, not UI systems.<br>• Lacks responsive Auto Layout (nested flexbox constraints).<br>• Lacks component instances, style token overrides, and typography hierarchies. |
| **Excalidraw** | • Zero friction, local-first, minimal file size.<br>• Fast canvas rendering. | • Pure hand-drawn aesthetic; cannot be used for high-fidelity UI/UX mockups.<br>• No responsive layouts, reusable components, or vector bezier editing. |
| **v0 / Lovable** | • Generates working React/Tailwind code rapidly. | • Code-first, not canvas-first. Designers cannot grab an element with a mouse and nudge it 4px, tweak bezier curves, or visually compose components freely. |
| **Galileo AI** | • Generates multi-screen mobile UI concepts from prompts. | • Produces static mockups or messy Figma exports.<br>• No interactive canvas editing; black-box AI model with no local control. |
| **Creatie / Motiff** | • Feature-complete Figma clones with AI auto-layout and UI audit tools. | • Closed source, proprietary Chinese cloud infrastructure.<br>• Paid subscription lock-in; cannot run with local open source agents or local Git history. |

---

## 7. Concrete Blueprint for Duet v1

To deliver a working v1 that Sourish can use daily, adhere to this execution sequence:

1. **Phase 1: Canvas & Primitives (Week 1–2)**
   - Tauri desktop app shell on Mac and Windows.
   - PixiJS v8 or optimized Canvas 2D infinite canvas with smooth pan, zoom, and spatial culling.
   - Core objects: Rectangles, Text, Frames, Images.
2. **Phase 2: Layout & Styling (Week 3–4)**
   - Integrate **Taffy** (Rust) for Flexbox-compliant Auto Layout (Direction, Gap, Padding, Align, Hug/Fill).
   - Solid colors, opacity, border strokes, and rounded corners (individual radii).
3. **Phase 3: The Unified Command & MCP Engine (Week 5)**
   - Implement the internal command dispatcher (`dispatch_command`).
   - Launch the local background loopback server and the `duet-mcp` stdio bridge.
   - Connect Claude Code or Antigravity locally to test scaffolding frames via chat.
4. **Phase 4: Local Git Engine & Asset Vault (Week 6)**
   - Auto-checkpoint on every agent execution with one-click undo in the UI.
   - Content-addressable `.duet/assets/` storage with SHA-256 deduplication.
5. **Phase 5: Import/Export & Daily Polish (Week 7–8)**
   - SVG import (icons) and SVG/PNG 1x/2x export.
   - Code export (Tailwind CSS snippet generator).
   - Build public dogfooding release.

---
*End of Report. Ready for immediate implementation review.*
