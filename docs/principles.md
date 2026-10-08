# Duet principles

Written from Sourish's own words, 8 October 2026. This is the core of the app.

## What Duet is

A free, open source desktop design app, made by a designer for designers. Hands-on first, with AI built in from the start. Opinionated: it ships with design skills and a point of view.

Primary focus is UI/UX. It should be good enough that people also use it for graphic design, and later for print and book layout.

## Shipping rule

Only build and promise what is real. No fake demo features. Mockups are for Sourish and the builders, to understand what we are making. The app is something Sourish can use every day.

## The core idea: the human and the AI use the same controls

Everything the person can do, the AI can do. Everything the AI can do, the person can do by hand.

1. **One command layer.** Every action is a named command ("move element", "set fill", "open settings"). Every button, shortcut and menu item calls a command.
2. **The AI gets the same commands.** Exposed through a local MCP server and usable by any terminal agent running behind the app. No hidden controls. No AI-only controls.
3. **Boot context.** When an agent starts, it is told where it is and who it is: the project, the page, the selection, the skills it has. Its name does not matter.
4. **Guardrails.** Three levels:
   - Suggest only.
   - Ask first. Default for settings and anything destructive.
   - Auto, if the user chooses it.
5. **Safety net.** Git takes a checkpoint before every AI action. Anything the AI does can be undone in one click. That is what makes loosening the guardrails safe.
6. **Visible history.** AI changes and human changes are marked differently in the history strip.

## Two ways in

- **Draw first.** The designer sketches. The agent watches the changes and suggests.
- **Describe first.** The designer describes an idea in chat. The agent scaffolds a starting point. The designer then edits by hand.

Either way the agent tracks what is happening and understands the intention, so the designer stays in flow.

## Skills

The agent knows design. Skills ship with the app and are curated by Sourish, starting from the skills in his kit repo. Later, UX and graphic designers join and add more.

## Canvas

Figma and Illustrator feel: a big canvas where an element can sit anywhere, on a frame or off it. Very lightweight. Our own canvas, our own icons, our own colours. Nothing copied from other tools.

## Documents

Designs are saved as plain files, so Git history is readable and the agent can read every change.

## Platforms and distribution

- Built on a Mac, but many users will be on Windows, especially in India. Both are first-class.
- Free forever, open source, public from day one of the first working build.
- Unsigned apps for now. Install tutorials cover the Mac and Windows warnings.
- Free version cannot rely on paid API keys. Users bring the AI tool they already have.
- Building in public. Audience feedback shapes it from the start.

## Likely stack (not final)

Tauri for the shell, which needs Rust. Own canvas renderer. Plain JSON documents.
