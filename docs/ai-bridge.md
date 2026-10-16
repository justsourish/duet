# The AI bridge

How agents work with Duet, from the chat inside it or from outside. Written 8 October 2026, brought up to date 12 October 2026.

## The idea

A designer and an AI share the same controls. Every change in Duet is one named command. The interface calls them when you click. Agents call the very same ones through MCP.

## How it is built

- **A local server.** When Duet starts, it opens a small server on `127.0.0.1` at a random port. Only this computer can reach it. A secret token is required on every request. Port and token are written to `~/.duet/session.json` (readable only by the user), and also handed to the interface.
- **MCP over HTTP.** The server speaks MCP (JSON-RPC over POST to `/mcp`): `initialize`, `ping`, `tools/list`, `tools/call`. The answer to `initialize` carries the working rules as `instructions`, so an AI that connects from outside is told how to work here. It does not stream events to the agent, so GET returns 405.
- **The interface owns the design.** The server passes each request to the interface, waits for the answer, and returns it. The design is never held in two places.
- **The chat runs the agent you already have.** Duet starts the agent tool in the background, writes your message to its input, and streams what it says back into the chat. Claude Code and Antigravity work today, and a switch in the chat picks one. Claude Code is started with every built-in tool turned off. Antigravity cannot be locked down that way: in print mode it runs its own shell and browser tools without asking, and its `--sandbox` flag did not stop it (tested 8 October 2026, agy 1.3.1). So Duet starts it in its own empty workspace, tells it in the message to use only the Duet tools, and shows a line in the chat whenever it reaches for one of its own.

## Tools

`get_context`, `get_working_rules`, `get_outline`, `get_document`, `look_at_image`, `look_at_design`, `look_at_attachment`, `select_elements`, `create_element`, `create_elements`, `create_instance`, `place_image`, `make_mask`, `trace_image`, `set_props`, `duplicate_elements`, `move_elements`, `resize_element`, `reparent_elements`, `export_frame`, `delete_elements`, `create_design_file`, `create_media_file`, `set_duration`, `set_timing`, `set_entrance`, `animate`, `set_curve`, `place_video`, `place_sound`.

`get_working_rules` returns how to work in Duet and the turned-on skills in full. It is for an AI connected from outside, which has not been given them with the message.

`create_element` also makes a `path`: any shape drawn as one outline, given as SVG path text in `d` (lines, curves and arcs), measured from `x`, `y`. `set_props` takes `d` to redraw one path, and `rotation` in degrees. Frames and copies of components cannot be turned, and the tool says so.

`look_at_attachment` shows the AI a picture the designer attached to a chat message (dropped, pasted, or picked with the picture button in the message box). Attached pictures are shrunk, kept only in the conversation (`src/ai/pictures.ts`), listed in `get_context` as `attachedPictures`, and never placed on the canvas or saved in the project. They do not travel inside the message: the AI is told they are there and asks for each one, so Claude Code, Antigravity and an AI connected from outside all get them the same way. A picture still waiting in the message box is listed too, so an outside AI can be told to look at it.

`place_image` reads a picture file from the computer by its full path and puts it on the canvas. Only picture files are accepted. Because a picture the AI then looks at is sent to the AI service, the designer is asked first in Ask first mode, the same as for deleting.

## Making files without Duet open

Two tools are answered by the bridge itself (`src-tauri/src/files.rs`), so an AI tool can use them while Duet is closed: `create_design_file` (a new `.duet` file, empty or from design JSON, with its first step in the history) and `create_media_file` (a picture, sound, video or plain text file, by copying a file, from text, or from base64). Any folder works. They only make something new and never replace a file. Hidden folders, system folders and `..` are refused, and only picture, sound, video and plain text types are allowed. Added 15 October 2026 (issue 97).

Permission levels: Duet writes its level to `~/.duet/agent-workspace/permission.json` whenever it changes (`src/ai/mcp.ts`), and the bridge reads it. In Suggest the two tools refuse and say why. In Ask first and Auto they go ahead, because asking is not possible with Duet closed and a new file replaces nothing. No note on disk means go ahead. Added 16 October 2026 (issue 97).

Not done: Duet does not show new files from a folder (decided against a folder mode: it adds a second way to open work for little gain), and an AI cannot yet edit an existing design while Duet is closed. The design in a new file is checked only for its outline until Duet opens it.

`export_frame` saves a frame or shape as a PNG file at its true size, or up to 4 times larger with `scale`. The path must be a full path to a new `.png`, outside hidden folders. It never replaces a file, and it does not change the design. It follows the Deleting column below: the designer is asked first in Ask first mode, and in Suggest mode it is only shown as a suggestion. Added 16 October 2026 (issue 99). Checked live in Duet dev: a 300 by 120 frame saved at 2x came out 600 by 240, saving over it was refused, and a relative path, a hidden folder, a missing id and a scale of 9 were each refused.

## Permission levels

Enforced inside Duet, not left to the agent.

| Level | Design changes | Deleting |
| --- | --- | --- |
| Suggest | Shown as a suggestion with an Apply button. Nothing changes. | Same |
| Ask first (default) | Applied straight away | The designer is asked first |
| Auto | Applied | Applied |

Bringing in a picture file follows the Deleting column.

`make_mask` puts things in a group with a shape, and they show only inside that shape.

`trace_image` turns a picture with a plain or see-through background into flat paths, one for each separate part, laid over the picture. It refuses a busy picture and says why.

Every AI change is a step in the history, marked as Duet's (bottom lane), saved right away, and undoable. This is the same for the chat inside Duet and for an AI connected from outside, because both go through the same code (`callTool` in `src/ai/tools.ts`). A suggestion or a question opens the chat if it was folded away, so it is not missed while the designer is looking at another window.

## Skills

Plain Markdown files. A heading, a one-line summary, then rules. Four ship with Duet. Your own are saved in `~/.duet/skills/` and travel across projects. Turned-on skills are put in front of the agent on every message. Switches are remembered per computer.

## Connecting an AI from outside

Any AI tool that can run a command as an MCP server can work on the design that is open in Duet. The command is the Duet app itself, started as a small bridge:

```
/Applications/Duet.app/Contents/MacOS/duet-app --mcp-bridge
```

The bridge (`bridge()` in `src-tauri/src/ai.rs`) speaks MCP over stdin and stdout and passes each request to the Duet that is running right now, which it finds through `~/.duet/session.json`. So it is set up once and keeps working when Duet is restarted, even though the port and token change every time.

In the app, the chat has **Connect your own AI**, with a copy button for each tool (`src/ui/ConnectAi.tsx`):

- **Claude Code**: `claude mcp add --scope user duet -- "<duet app>" --mcp-bridge`
- **Codex**: `codex mcp add duet -- "<duet app>" --mcp-bridge`
- **Claude desktop app** and **Cursor**: `"duet": {"command": "<duet app>", "args": ["--mcp-bridge"]}` inside `"mcpServers"`.

What the bridge does when Duet is not there:

- **Duet is closed.** The bridge answers `initialize` and `tools/list` by itself, from `~/.duet/agent-workspace/bridge.json`, which Duet writes each time it starts. A tool call returns "Duet is not open. Ask the designer to open Duet, then try again." So an AI tool that starts before Duet still connects, and works as soon as Duet is open.
- **Duet is still opening.** The server waits up to 15 seconds for the interface to say it is listening (`mcp_ready`) before it passes a request on.

By hand, without the bridge: read `~/.duet/session.json`, then POST to `http://127.0.0.1:<port>/mcp` with the header `Authorization: Bearer <token>`.

## Which AI tool made a step

Each AI tool says a short name for itself when it connects (`clientInfo.name` in MCP). The bridge remembers it and sends it with every request as the `X-Duet-Client` header. A tool started from Duet's own chat is given the header by Duet, marked `chat:`. The name is only a label: it opens nothing, and the secret is still what lets a request in.

`src/ai/who.ts` turns it into the name a designer knows (Claude Code, Codex, Cursor, Antigravity). A step made by an AI keeps that name (`by` on the step in `src/state/store.ts`), it is saved with the step as a `By:` line, and the history shows it when a step is hovered. While a tool works from its own window the chat says so (`src/ai/outside.ts`), and stops six seconds after its last change.

Checked on 13 October 2026 on the running app: steps from three tools each kept their own name, the bridge passed on the name a tool gave, and the line in the chat came and went. Not checked by hand: the name after a project is closed and opened again, which is covered by tests only. Not done: the words asked in the other tool's window, and the name beside each change listed in the chat.

`dev_history` (a builder tool, below) lists the last steps and who made each.

## Builder tools, for building Duet itself

These are not for designers. They let an AI that works on Duet's code check the interface without a person clicking through it. Only the build Duet is developed with (`npm run tauri dev`) has them: `src/ai/mcp.ts` loads `src/ai/builder.ts` only there, and the downloaded app does not contain the file. Their names all start with `dev_`.

- `dev_guide`: how to use the rest. Read it once.
- `dev_test_design`: puts the open project away and starts a clean design with no file, so nothing a check does is saved. With `sample` it starts with a frame that holds a shape and a group, and a plain shape beside it. `dev_leave_test_design` throws it away and brings the project back.
- `dev_read_interface`: what the panels show, as numbered lines of words (buttons, boxes, rows, tabs and text, with their style names and values). Words, not a picture, so it costs little. `filter` narrows it.
- `dev_press`, `dev_type`, `dev_key`: press something by name or line number, write in a box, press a key.
- `dev_errors`: errors and warnings since the last look.
- `dev_reload`: loads the interface again after Duet's code has changed.

They press the interface the way a hand does, so the permission levels do not apply to them. That is why they are kept out of the app a designer downloads.

They cannot draw on the canvas by dragging, drag a layer, or answer a window from the system such as Save. They give no picture of the whole window. Checked on 13 October 2026 against the running app: a test design opened and closed with the real project untouched, a tab was switched, a layer was selected, a position was typed and undone, and a tool was picked by key.

**Use them in Duet dev, not in the Duet a designer works in.** `scripts/dev-duet.sh` starts a second Duet with an orange ring on its Dock icon and an orange "dev" mark in its top bar. It keeps its own folder (`~/.duet-dev`), so it has its own address and secret for AI tools, its own working copies and its own skills. It never opens a project by itself and leaves the list of recent projects alone. `scripts/dev-duet.sh stop` closes it. This exists because on 13 October 2026 checks run in the one running Duet put a Save window in front of real work several times. `dev_test_design` also refuses when another AI tool changed the project in the last two minutes.

To call them without an AI tool, see "How to test an agent against the live app without clicking" in `docs/next-steps.md`.

## Checked

On 8 October 2026, Claude Code 2.1.293, started with the same settings the chat uses, connected, read an empty canvas, and built a frame with a rounded button and a centred label. Antigravity 1.3.1 connected through the bridge and read the canvas. The bad-token, wrong-path, unknown-tool and missing-id cases all return clear errors.

On 12 October 2026, from outside Duet and through the bridge:

- Claude Code in a terminal read the working rules and skills, built a screen with a button, and added an icon. Every change was saved as Duet's step.
- Codex 0.142.0 added a line of text. Run without a person (`codex exec`) it cancels every Duet tool unless `mcp_servers.duet.default_tools_approval_mode = "approve"` is set. Run normally it asks the person.
- Suggest: a move changed nothing until Apply was pressed in Duet. Ask first: a delete waited, was refused on "Not now", and went through on "Allow". Auto: a delete went straight through.
- With Duet closed, the bridge still gave the tool list and told the AI to open Duet.
- Not run: the Claude desktop app and Cursor. Neither is on the computer this was built on. They use the same bridge.

## How each tool is connected from the chat

- **Claude Code**: `--mcp-config` and `--append-system-prompt-file`, both pointing at private files in `~/.duet/agent-workspace/`. It is started with every built-in tool turned off.
- **Antigravity**: only reads MCP servers from its global list. Duet adds one entry, `duet`, the first time you use it (`agy mcp add duet <duet app> --mcp-bridge`), the same bridge as above. Instructions go in with the message. Follow-up messages use `--conversation <id>`. If Antigravity cannot be connected automatically, Duet explains why and gives the manual command (`agy mcp add duet "<duet app>" --mcp-bridge`).
- **Codex, OpenCode**: detected, but not offered in the chat yet. Codex works from outside, as above.

## Not done yet

- Codex and OpenCode as tools the chat itself can start.
- Windows. The agent is started through `cmd`, which is untested, and so is the bridge (issue 106).
- An outside AI keeps its own tools (files, commands). Duet only controls what happens on the canvas.

## Working while Duet is closed (issues 97, 103, 104, 105)

Built in Duet 0.6.0: one app, one copy, with no second hidden version and no lock file.

- **Closing the window while an AI works:** hides the window and keeps Duet running in the background until the AI is done, then quits by itself. An icon in the menu bar shows it is running, with options to show the window or quit. With no AI working, closing the last project tab or window quits normally.
- **Starting in the background:** when an outside AI calls a tool and Duet is closed, the bridge starts Duet in the background with no window. It exits after about a minute of inactivity once the AI finishes. Opening Duet from the dock shows the window on that same running instance.
- **Bringing the window back:** if the AI asks a question, makes a suggestion in Suggest mode, or changes work that has not been saved, Duet brings the window back on screen (`bring_back`). Bringing the window back keeps Duet open after the AI finishes.
- **Quitting:** Quit (Cmd+Q) stops the AI, asking for confirmation first if an AI is mid-change.
- **AI working area on canvas:** an AI that is working marks its area on the canvas with a roomier tinted area, a flat glass shine sweeping across, and a thin light running around its edge in its colour, so the designer sees where it is working. Pressing Tab on a selection sets the AI focus area.
- **Open projects and tabs:** open projects show as tabs in the top bar, and the chat clearly displays which project the AI is working on, with calm buttons and quiet reassurance showing which AI is active.
- **File making:** `create_design_file` and `create_media_file` can create files anywhere even while Duet is closed, respecting Suggest mode (refuses in Suggest, proceeds in Ask first and Auto).
