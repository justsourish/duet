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
- Local leftovers on the creator's Mac (not in the repo): `~/.duet/agent-workspace/.gemini/` and `GEMINI.md`. They can be deleted.

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

Done on 12 October 2026, not yet in a version: rotation for everything except frames and copies of components, and the AI can draw paths from SVG path text. Masks are done too (12 October 2026): a group with `mask` set shows its things only inside its bottom shape, which is not drawn (`maskOf` in `src/document/geometry.ts`). Tracing is done too (12 October 2026): our own tracer in `src/document/trace.ts` (find the subject, walk its outline along pixel edges, thin the points, smooth them), applied by `src/project/trace.ts`. One flat shape for each separate part. Holes are filled in and colours inside a part are averaged. Still open from the same request: boolean cuts. They need a drawn shape to hold more than one outline first (today `nodes` is one outline). That changes the file format, node editing, hit testing and export, so plan it as its own batch. Once shapes can have holes, tracing should keep them. Removing the background from a real photo needs a machine learning model, so do not promise it.

Also done on 12 October 2026, not yet in a version: a zoom tool on Z, the AI can bring in a picture file (`place_image`, asked first), the chat can no longer slide out of its own box, the "working" line in the chat clears when a tool finishes, and the AI tool runs in its own session so its helpers are stopped with it (a leftover Antigravity helper was found spinning a whole core). The installed app in `/Applications` was rebuilt from this code without a version bump.

Also done on 12 October 2026, not yet in a version: an AI can work on the open design from outside Duet (Claude Code in a terminal, Codex, the Claude desktop app, Cursor) through the bridge, set up from **Connect your own AI** in the chat. See `docs/ai-bridge.md`. Arrow keys held down or tapped quickly count as one step in the history (`nudge` in `src/state/store.ts`). The close button on the window closes Duet (the window needed the `core:window:allow-destroy` permission).

Pictures in the chat (issue 7) are done too, 12 October 2026, not yet in a version: drop, paste or pick pictures into a message, up to six, each shrunk. Still open from that issue: a link to a picture is not fetched. Checked in the browser preview and by tests, and on 13 October 2026 by the creator in the app with a real AI tool. Issue 7 is closed.

A conversation for each project (issue 24), 13 October 2026, not yet in a version: opening another project puts the conversation away and brings that project's own one back (`showConversationFor` in `src/ai/chat.ts`), and the AI picks up the matching conversation. If the AI is working, Duet asks first: let it finish, or stop it and open (`readyToLeave` in `src/ai/agent.ts`). Checked by tests and by hand, except the conversation switch. Still to decide, see the issue: whether a conversation survives closing Duet and where it lives, a handoff note when the AI cannot pick its old conversation up, and telling an AI that works from outside when the project changes.

The conversation is kept with the project (issues 26 and 27), 13 October 2026, not yet in a version. It is written to `memory/thread.json` in the project's working folder, so it is packed into the project file, and it comes back when the project is opened (`src/memory/`, wired up in `src/project/project.ts`). "Start a fresh conversation" puts the old one away instead of deleting it. The AI no longer carries one long session on: a session is used again only for a short, recent back and forth (`carryOn`), and otherwise the AI starts fresh with a short note that Duet writes from the thread (`brief`). Switching AI tools keeps the conversation. Checked by tests and a build, not yet by hand in the app, and the saving in tokens has not been measured. Not done yet: tying each message to the step it led to, a way to read earlier conversations, and project notes. The milestones on GitHub hold the order of work.

Send a copy (issue 30), 13 October 2026, not yet in a version: **File, Send a copy** opens a small window and saves a second project file to hand to someone else. It holds the design as it is on the canvas, only the pictures that design uses, and a fresh preview. Two switches, off every time it opens, add the history and versions, or the conversation. The project being worked on is not changed and stays open. The copy is built from a list of what to keep (`pack_copy` in `src-tauri/src/package.rs`), so anything a project holds later, such as notes, stays out until it is added there on purpose. The flow is `sendCopy` in `src/project/project.ts` and the window is `src/ui/SendCopy.tsx`. Checked by tests and by hand, except the conversation switch.

How rotation is built, so the next change does not fight it: only things with no children are drawn turned (`turnOf` in `src/document/geometry.ts`). A group has no turn of its own. Setting its `rotation` swings what is inside it and remembers the angle. So positions up the tree are still plain sums, and frames clip and lay out as before.

Words tied to steps, 13 October 2026, not yet in a version: a change the AI made shows a "Show this step" link in the chat, and a step in the history shows what was asked for. Each step carries its own name, kept when the project is saved. See `src/memory/steps.ts`.

The chat shows bold, code and lists in what the AI writes (`src/ui/rich.tsx`), 13 October 2026, not yet in a version.

### Work handed to a helper agent

Small, safe tasks go to a cheaper agent. The rules are in `AGENTS.md` under "If you are a helper agent". A check in `.githooks/pre-commit` runs before every save: it refuses failing tests, and on a `helper/` branch it refuses changes to saving, history, the file format, memory and permissions. Switch it on in a fresh copy with `git config core.hooksPath .githooks`. Tasks are issue comments titled "Task for a helper agent", on issues with the label `helper task`. The first three are issues 16, 6 and 9, in that order. Each ends with a click list for the creator. Review by reading the list of changed files, and open a file only when it is a risky one.

Since 13 October 2026 the main AI starts the helper itself, with `scripts/helper.py`. The creator no longer pastes tasks into Antigravity.

- `scripts/helper.py run <issue> <two-words> --task "..."` makes a copy of the code beside this folder (`../duet-helpers/`), on its own branch, and starts Antigravity there with no one clicking. The task is three lines: what to do, which files, how we know it is done. The standing rules are not repeated, they are in `AGENTS.md`.
- Everything the helper does is written as it happens to `../duet-helpers/logs/<issue>-<two-words>.log`. The creator can watch with `tail -f`.
- It ends with a summary of a few lines: saves, checks, files, whether it stayed in its lane, its own tokens. The main AI reads that, not the code, and checks interface work with the builder tools. It adds a row to `docs/helper-agent-research.md` by itself.
- `keep` brings the work onto main and clears up. `drop` throws it away. `status` says if one is working.
- One helper at a time, twenty minutes unless told otherwise. A fix of a few lines is quicker done directly and is not handed over.
- Not for tasks that need the app run by the helper, or a drag on the canvas checked. Those still need a person, or better builder tools.

### Which AI is working (issue 39)

Done on 13 October 2026, not yet in a version: every step an AI makes keeps the name of the AI tool that made it, it is saved with the project, the history says it on hover, and the chat says who is working from its own window. See "Which AI tool made a step" in `docs/ai-bridge.md`. Outside tools connect through the bridge of the installed app, so the installed app has to be rebuilt before they send their names. Still open from the issue: the words asked in the other tool's window, and the larger picture in the creator's comment there (the whole process around a design, shown in the lower panel).

### Builder tools, so an AI can check the interface itself

Done on 13 October 2026 (issue 41), not yet in a version. An AI that works on Duet can start a clean test design, read the panels as words, press things and read errors, through the same bridge as the design tools. Only the build Duet is developed with has them. See "Builder tools" in `docs/ai-bridge.md`, and `src/ai/builder.ts`. The test design is `startTestDesign` in `src/project/project.ts`. Use them to check interface work, including a helper's, before asking the creator to click. Still open: dragging on the canvas and in the layers, and a picture of the whole window.

### Waiting for the next version: the website docs

Written 12 Oct 2026. The website repo has a `docs` branch (one commit on top of `main`, not pushed, not deployed) with a Docs section: eleven Markdown pages in `src/content/docs/`, built the same way as Updates. They describe the build on `main` here, which is ahead of the 0.3.1 download (rotation, the zoom tool, masks, trace, see-through pictures, anything as a component). So they must go live together with the version bump, not before. At the bump: merge `docs` into `main` in the site repo, check each page against the app, update `src/content/status.ts`, run `npm run release:sync`, write the update post, then deploy. The creator decides when.

Ideas from a call with a motion designer on 12 Oct 2026 are issues #12 to #23. The largest is animation and a timeline (#12), which is the bridge to motion graphics and video.

## 3. Known gaps
- The Windows build has never been run by anyone. The agent is launched through `cmd` and is untested.
- The app is unsigned (the creator cannot afford certificates yet). The download page explains the first-launch warning.
- No automated UI tests. The interface was checked by hand in a browser at `http://localhost:1420` (the Vite dev server).

## 4. Rules to keep
- Licence: PolyForm Shield 1.0.0 (source available, not open source). v0.1.0 was MIT.
- Never write "open source" about Duet. Never write that the creator is "not a developer" (he is a design engineer). Call the booking button "Talk to the creator".
- Every design change goes through a command in `src/commands/`. Permission levels are enforced in `src/ai/tools.ts`.
- Use the GitHub noreply email in this repo. No tool names or attribution in commits.
