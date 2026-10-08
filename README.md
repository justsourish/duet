# Duet

An opinionated design tool, built by designers, for designers. You and your AI work hand in hand on the same canvas.

Free to use. The code is public, so you can read it, learn from it and change it for yourself. See [Licence](#licence).

You draw by hand. When you want help, you ask Duet in plain words, and it changes the design with the very same controls you use. Every change it makes is marked as its own in your history, and you can undo any of it.

Duet is early. It is built in public, and it is being shaped by the designers who try it.

## What works today

- An infinite canvas with frames, rectangles, ellipses, text, pictures and drawn lines. Pan, zoom, select, move, resize (Shift keeps proportions, Option scales from the centre), snapping guides.
- A pen tool with corners and smooth curves, and point editing: double-click a line to move points, pull handles, add and remove points.
- Pictures: drag them in, paste them, or use the Image button. They are kept once inside your project folder.
- Auto layout: Shift A lines up what is inside a frame in a row or a column, with gap, padding, alignment, hug and fill.
- Groups (Cmd G), locking (Shift Cmd L), select all in context (Cmd A), and a selection box that picks a frame's contents.
- Layers panel with drag and drop in and out of frames. Properties for position, size, corners, fill, gradient, stroke, shadow, opacity and text.
- Copy, paste and duplicate (Cmd or Ctrl + D), including between projects.
- Export PNG (1x, 2x, 3x) and SVG, for one thing or every screen.
- Prototype in its first form: link a shape to another screen, press Present, and click through.
- Projects are plain folders. Your design is a readable `design.json` that saves itself as you work.
- A history that survives closing the app, drawn as two lanes: **You** and **Duet**. Save a named version ("Client round 1") and go back to it any time. Nothing is ever lost when you go back.
- A chat with an AI that works on your canvas, and can look at your pictures and your design when it needs to. Three permission levels: Suggest, Ask first, Auto. Pick your AI tool: Claude Code or the Antigravity CLI.
- Skills: short rule files that shape how the AI designs (spacing, type, contrast, mobile screens). Turn them on and off, write your own, or import skill files and folders.
- A project is a folder ending in `.duet`, with your design and its history inside.

## What does not exist yet

Be honest with yourself before you try it for real work.

- No components, text styles or boolean operations yet. Gradients are linear only, and there is one shadow per shape.
- Prototyping is links between screens only. No transitions or animation yet.
- The AI chat works with **Claude Code** and the **Antigravity CLI** today (the command line tools, not the desktop apps). Codex and OpenCode are detected but not connected yet.
- Windows builds are new and less tested than Mac. The AI chat on Windows is untested.
- The app is not signed, so your computer will warn you the first time. See the install guide.

## Bring your own AI

Duet has no AI of its own and no servers. It uses the AI tool you already have on your computer, so it costs nothing extra to run and your design stays with you.

To use the chat today: install [Claude Code](https://claude.com/claude-code) or Antigravity, sign in once in a terminal, then open Duet. Use the AI tool switch in the chat to choose.

## Install

Download the latest build from the [Releases page](https://github.com/justsourish/duet/releases). Step-by-step help, including the first-launch warning, is in [docs/install.md](docs/install.md).

## Build it yourself

You need Node 22 or newer and Rust.

```sh
git clone https://github.com/justsourish/duet.git
cd duet
npm install
npm run tauri dev
```

Run the checks:

```sh
npm test                                  # front end
cargo test --manifest-path src-tauri/Cargo.toml   # history and files
```

## How it is put together

- **Tauri** shell, **React** panels, and a plain **Canvas 2D** renderer.
- Every change to a design is a named command. The interface and the AI use the same ones. See [docs/principles.md](docs/principles.md).
- The AI talks to Duet over a small local MCP server. See [docs/ai-bridge.md](docs/ai-bridge.md).
- History is Git, bundled inside the app, so designers never need to install it or learn it.
- The plan for the first version is in [docs/v1-scope.md](docs/v1-scope.md).

## Contributing

Designers, developers, and people who just have opinions are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). The most useful thing you can do right now is use Duet for something real and tell us what got in your way.

## Licence

Duet uses the [PolyForm Shield 1.0.0](LICENSE) licence. In plain words:

- Use Duet for anything, including paid client work.
- Read the code, learn from it, and change it for yourself.
- Do not sell Duet, repackage it, or offer it (or a changed copy) as a product or service that competes with it.

That makes Duet **source available**, not open source in the strict sense, because open source licences allow reselling. Duet 0.1.0 was released earlier under the MIT licence, and that release stays MIT. Everything after it uses PolyForm Shield. The licence covers the software only. What you make with Duet is yours.
