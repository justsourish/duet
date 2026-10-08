# Duet

An opinionated, free-to-use desktop design app (source available under PolyForm Shield) where a designer and an AI work on the same canvas. Read `README.md` for what exists, `docs/principles.md` for why.

## Run it

```sh
npm install
npm run tauri dev          # the app
npm test                   # front end tests
npx tsc --noEmit           # type check
cargo test --manifest-path src-tauri/Cargo.toml    # history and file tests
```

Restart `tauri dev` after installing a new npm package. Vite re-bundles dependencies mid-session and the open window can break until restarted.

## Layout

- `src/document/` the flat JSON document, geometry, and the file format (`serialize.ts`).
- `src/commands/` every change to a design. Pure functions, document in and document out.
- `src/state/store.ts` the one store: history timeline, selection, viewport, project.
- `src/canvas/` Canvas 2D renderer, pointer and keyboard handling, resize handles.
- `src/ui/` panels: layers, skills, properties, history strip, chat, toolbar.
- `src/ai/` agent runner, MCP responder, tools with permission rules, chat store, skills. Shipped skills are Markdown in `src/ai/skills/`.
- `src/project/` open, save, autosave, versions.
- `src-tauri/src/lib.rs` file access, bundled Git history (libgit2), user skills in `~/.duet/skills`.
- `src-tauri/src/ai.rs` local MCP server (127.0.0.1, token), and the runner for the user's agent tool.
- `mockups/` how the interface was thought through. `docs/` plans and decisions.

## Project links

- Website (private repo `justsourish/duet-site`, folder `~/Desktop/DEV/duet-site`): https://duet.noisyarchitects.org. Deploy with `npm run deploy` there. Update what works in `src/content/status.ts` after each version.
- Feedback form: https://forms.gle/Zs6s7bX6CpJigCCf6. Creator booking: https://cal.com/rish-lc/coffee.
- Release: push a tag like `v0.2.0`. GitHub Actions builds Mac and Windows installers into a draft release. Publish with `gh release edit <tag> --draft=false --prerelease`.
- Licence: PolyForm Shield 1.0.0 (source available, not open source). v0.1.0 was MIT.
- Use the GitHub noreply email in this repo: `10191373+justsourish@users.noreply.github.com`.

## Rules

- Every design change goes through a command in `src/commands/`. The interface and the AI use the same ones. Never edit the document any other way.
- Commands never mutate. Add a test when you add one.
- Permission levels (suggest, ask first, auto) are enforced in `src/ai/tools.ts`, not left to the agent.
- Designer language in the interface. No commit, tag, JSON or id in front of a designer.
- Only build and promise what is real. Half-built features stay out of the interface.
- Nothing copied from other design tools. Own icons, colours and code.
- Commits carry the author's identity only. No tool names or attribution lines.
- No secrets in the repository. The agent token lives only in `~/.duet/session.json`.

## Working with the person who started this

- Short messages. One idea per line.
- Plan in chat before changing files. After the plan is agreed, work end to end.
- Research goes to Gemini, not here. Treat its answers as unverified until checked.
