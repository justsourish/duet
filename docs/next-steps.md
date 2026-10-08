# Next steps (handoff)

Written 8 October 2026 for whoever picks this up next, human or agent. Read `AGENTS.md` first, then this.

## 1. Decided but not done: swap Gemini CLI for Antigravity

**Decision (the creator, 8 Oct 2026):** remove Gemini CLI from Duet. Add only Antigravity (`agy`). Claude Code stays.

**Why:** the creator's Gemini CLI (v0.63.0) shows "Authenticated with gemini-api-key". Google login no longer works with it, so it runs on the free-tier API key. That is rate-limited and returned 503 errors in testing. It is not reliable enough to ship as a chat option.

**No code has been changed yet.** Everything below is the plan.

### Remove Gemini
- `src/ai/chat.ts`: drop `gemini` from `AGENTS`, and from `AgentId` if nothing else needs it.
- `src/ai/agent.ts`: remove `onGeminiLine`, `streamText`/`streamId`, the `gemini` branch in `sendToAgent` (it writes `.gemini/settings.json` and `GEMINI.md` into `~/.duet/agent-workspace`), and the `--resume latest` handling.
- `src-tauri/src/ai.rs`: remove `gemini` from `supported()`. Keep `known()` listing the tools Duet should detect.
- `src/ui/ChatPanel.tsx`: the AI tool picker lists `AGENTS`, so it follows automatically.
- Docs: `README.md`, `docs/install.md`, `docs/ai-bridge.md` (the "How each tool is connected" section), `docs/v1-scope.md`.
- Website repo `justsourish/duet-site`: home bento card "Bring the AI you already use", `src/lib/faq.ts`, `src/content/status.ts`, `src/app/llms*.txt/route.ts`, `src/app/download/page.tsx` callout, `README.md`. Search for "Gemini".
- Delete `~/.duet/agent-workspace/.gemini` and `GEMINI.md` is only a local leftover, not in the repo.

### Add Antigravity (`agy`)
What was learned on 8 Oct 2026 (agy 1.3.1, installed at `/opt/homebrew/bin/agy`):
- Non-interactive: `agy --print "<prompt>" --output-format stream-json` works. Events are JSON lines: `{"event":"init", ...}` (lists many built-in tools, including browser tools), `{"event":"step_update", ...}` with `step_type:"agent_response"` and `text_delta`, and a final `{"event":"result", ...}` with `status:"SUCCESS"`. `--input-format stream-json` reads NDJSON from stdin.
- Other flags worth knowing: `--conversation <id>` (resume), `--continue`, `--add-dir`, `--mode`, `--model`, `--effort`, `--project`, `--sandbox`. `--dangerously-skip-permissions` exists. Do not use it.
- **MCP servers can only be added to global config:** `agy mcp add [flags] <name> <urlOrCommand>`, with `--type http` and `--header "Authorization: Bearer TOKEN"`. Also `agy mcp list`, `remove`, `enable`, `disable`. Flags must come before the name.
- Duet's MCP port and token change on every launch (`~/.duet/session.json`). So each run would have to update the global `duet` entry with `agy mcp add`. That is a global side effect on the creator's setup. **Ask the creator before doing it**, or look for a workspace-level config first.
- Unknown: whether `agy` in print mode refuses its built-in tools (browser, shell) without approval. Test this before shipping. Claude Code is started with `--tools ""`. Gemini ran in an empty workspace with approval mode `default`.
- Where to add it: `AGENTS` in `src/ai/chat.ts` (set `runnable: true`), `supported()` in `src-tauri/src/ai.rs`, a new branch in `sendToAgent` in `src/ai/agent.ts`, and a line parser like `onClaudeLine`.

### How to test an agent against the live app without clicking
1. Run the app (`npm run tauri dev`). It writes `~/.duet/session.json` (`port`, `token`).
2. Use MCP over HTTP: `POST http://127.0.0.1:<port>/mcp` with header `Authorization: Bearer <token>`.
3. Start the agent from `~/.duet/agent-workspace`, pointed at that URL, with a read-only prompt such as "what is on the canvas?". Check it calls `get_context` and answers.

## 2. The feature push the creator wants next
In rough order of value: auto layout (Taffy, in Rust or WASM), image import (content-hash assets under `.duet/assets/`), components and variants, text styles, pen tool and node editing, boolean shapes, snapping to spacing, richer prototyping (transitions). Also: a friendly "your AI tool is busy, try again" message for 503s.

After a batch of features: bump the version (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`), tag `v0.x.0`, let GitHub Actions build the draft release, publish it, then update the website:
- `src/content/status.ts` and `npm run release:sync` in `duet-site`, then `npm run deploy`.
- Add an update post in `duet-site/src/content/updates/`.

## 3. Known gaps
- The Windows build has never been run by anyone. The agent is launched through `cmd` and is untested.
- The app is unsigned (the creator cannot afford certificates yet). The download page explains the first-launch warning.
- No automated UI tests. The interface was checked by hand in a browser at `http://localhost:1420` (the Vite dev server).

## 4. Rules to keep
- Licence: PolyForm Shield 1.0.0 (source available, not open source). v0.1.0 was MIT.
- Never write "open source" about Duet. Never write that the creator is "not a developer" (he is a design engineer). Call the booking button "Talk to the creator".
- Every design change goes through a command in `src/commands/`. Permission levels are enforced in `src/ai/tools.ts`.
- Use the GitHub noreply email in this repo. No tool names or attribution in commits.
