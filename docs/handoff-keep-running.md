# Handoff: the AI works with Duet closed (issue 97)

Written 16 October 2026, to restart the work with a fresh session.

## Decided (see "Plan" in `docs/ai-bridge.md`)

One app, one copy, no lock file, no folder mode. Closing the window while an AI works hides it; Duet quits when the AI is done. If Duet is not running when an AI calls a tool, the bridge starts it with no window. A faint rectangle in the AI's colour shows where it works. Windows must work too.

## Issues

- 97 parent. Done: permission levels for the two file tools (Suggest refuses). On `main`.
- 103 keep running while the AI finishes. Done, on `main`, tried in Duet dev and click tested.
- 104 start in the background when the AI needs it. Done, on `main`, tried in Duet dev. The window comes back when the AI asks, suggests, or changes work that is saved nowhere (`bring_back`).
- 105 show where the AI works (faint rectangle). Not started.
- 106 Windows checks in CI, and Windows system folders off limits to the file tools (`safe_path` in `src-tauri/src/files.rs` only lists Mac and Linux folders). Not started.

## State of #103 (branch `wip/103-keep-running`)

Written, compiles, Rust tests pass (27), `tsc` clean. **Not tried in the running app.**

- `src-tauri/src/keepalive.rs` (new): `is_working`, command `keep_running_for_ai` (hides the window, shows a tray icon with Show and Quit, starts one watcher that exits Duet when idle), `hold_quit` (asks before Cmd+Q while an AI works), `show_window`.
- `src-tauri/src/ai.rs`: `Activity` managed in `start`; touched on each outside `tools/call`, on arrival and reply; `request_waiting` and `chat_agent_running` helpers.
- `src-tauri/src/lib.rs`: module, command, `ExitRequested` hold, Mac `Reopen` shows the window.
- `src-tauri/Cargo.toml`: tauri feature `tray-icon`.
- `src/App.tsx`: `onCloseRequested` asks `keep_running_for_ai` and calls `preventDefault` if true.

## Still to do for #103

1. Try it in Duet dev (`scripts/dev-duet.sh`, never the purple Duet): start a long AI task, close the window, see the tray icon, see Duet quit when the AI finishes. Check Cmd+Q warns. Check clicking the Dock icon shows the window.
2. Check that a window hidden by the app keeps the interface running (timers, the MCP listener).
3. Add the tray icon image for Windows if the default window icon looks wrong.
4. Click test from the issue, then commit and merge to `main`.

## Open questions for the creator

- None blocking. Windows behaviour is untested until a real Windows run (plan: free CI now, a VM later).

## Next after #103

#104 (start with no window; the bridge in `src-tauri/src/ai.rs` `bridge()` launches the app hidden when `session.json` has no live Duet, then forwards the call), then #105, then #106.

## Separate topic, raised and not decided

Focus mode (the designer points the AI at a selection with Tab) overlaps with the AI marking its own working area (#105). Question to settle first: if the AI chooses its own area, what is the designer's focus for? Idea: the designer's focus becomes "stay inside this", and the AI's rectangle is where it is actually working.

## Update, 16 October 2026 (later)

103 and 104 are on `main`. Project tabs now always show, include unsaved work, and have + for the projects screen (built by Antigravity, checked). Next: #105, after the creator answers the focus question above. Nothing pushed.

## Update, 16 October 2026 (late morning)

On `main` and pushed: 103, 104, 105 done and closed. Tabs work like a browser (home button, + for a new design, own top row beside the window buttons). File work no longer freezes the screen. Fill and stroke opacity, multiple anchor points, calmer chat pickers.

Left: #106 (Windows), designer focus meaning "stay inside this" (built once, taken out on request, easy to bring back from the 105 history), #107 video lag (done in 0.6.0 with smooth playback/scrubbing and bundled ffmpeg), #108 drawing mode. Skills, custom MCPs and plugins are the next big conversation.
