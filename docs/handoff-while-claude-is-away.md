# Handoff while Claude is away

Written 16 October 2026. For Antigravity, or anyone carrying on until Claude's credits return (around the 19th).

## What is built

- Duet 0.5.x on `main`. Last save: AI tools can make new design and media files anywhere, even with Duet closed (`src-tauri/src/files.rs`, tools `create_design_file` and `create_media_file`, answered by the bridge). Described in `docs/ai-bridge.md`.
- Duet dev (orange, `scripts/dev-duet.sh`) is for building and tests. The purple Duet in Applications is the creator's real work. Never open, draw in or reload it.

## What is next

1. Issue 97, rest of it: show files from a folder when Duet opens it; let an AI edit a design while Duet is closed; permission levels for the two file tools; later an agent mode.
2. Issue 98: a talking-character video format for daily content. The studied reel is in `ref/references/reels/DefJ92VxeGs/`.
3. From the cover agent's log (`scratch/linkedin-cover/agent-log.md`): there is no MCP tool to export a design as a picture. `look_at_design` gives a picture capped at 1536 pixels on the long side. File an issue if it still holds.

## Rules for any helper

Read `AGENTS.md`, section "If you are a helper agent". Short version: one task, a `helper/<issue>-<two words>` branch, never `main`, never push, no `--no-verify`.

## Brief template to paste to Antigravity

```
Task: <one thing>. Do only this. If something else looks wrong, write it in your report and leave it.
Read AGENTS.md first. Work on a branch named helper/<issue>-<two words>. Never push.
LOG: as you work, append every challenge you face to <folder>/agent-log.md as it happens:
what you tried, what blocked you, what you could not do, what was missing or unclear in Duet.
Include problems you worked around. Duet's team reads this to make Duet better for agents.
REPORT: list the exact commands you ran and their output. Report only what you really ran and saw.
If you could not do a step, say so plainly. Do not invent results.
```

Claude then re-runs the checks (`npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`) before trusting any report.

## Notes learned today

- `yt-dlp --cookies-from-browser chrome` makes the Mac ask for the keychain password, twice with two agents. Ask the creator first, or use a cookie file he exports once.
- Antigravity in print mode cannot ask permission for shell commands; the Mac prompts come from the tools it starts.
- Changing his LinkedIn or other accounts is his to click. Agents do not do it.
