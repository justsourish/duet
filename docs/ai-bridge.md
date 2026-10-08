# The AI bridge

How agents work inside Duet. Written 8 October 2026.

## The idea

A designer and an AI share the same controls. Every change in Duet is one named command. The interface calls them when you click. Agents call the very same ones through MCP.

## How it is built

- **A local server.** When Duet starts, it opens a small server on `127.0.0.1` at a random port. Only this computer can reach it. A secret token is required on every request. Port and token are written to `~/.duet/session.json` (readable only by the user), and also handed to the interface.
- **MCP over HTTP.** The server speaks MCP (JSON-RPC over POST to `/mcp`): `initialize`, `ping`, `tools/list`, `tools/call`. It does not stream events to the agent, so GET returns 405.
- **The interface owns the design.** The server passes each request to the interface, waits for the answer, and returns it. The design is never held in two places.
- **The chat runs the agent you already have.** Duet starts the agent tool in the background, writes your message to its input, and streams what it says back into the chat. Claude Code and Antigravity work today, and a switch in the chat picks one. Claude Code is started with every built-in tool turned off. Antigravity cannot be locked down that way: in print mode it runs its own shell and browser tools without asking, and its `--sandbox` flag did not stop it (tested 8 October 2026, agy 1.3.1). So Duet starts it in its own empty workspace, tells it in the message to use only the Duet tools, and shows a line in the chat whenever it reaches for one of its own.

## Tools

`get_context`, `get_document`, `select_elements`, `create_element`, `set_props`, `move_elements`, `resize_element`, `reparent_elements`, `delete_elements`.

## Permission levels

Enforced inside Duet, not left to the agent.

| Level | Design changes | Deleting |
| --- | --- | --- |
| Suggest | Shown as a suggestion with an Apply button. Nothing changes. | Same |
| Ask first (default) | Applied straight away | The designer is asked first |
| Auto | Applied | Applied |

Every AI change is a step in the history, marked as Duet's (bottom lane), saved right away, and undoable.

## Skills

Plain Markdown files. A heading, a one-line summary, then rules. Four ship with Duet. Your own are saved in `~/.duet/skills/` and travel across projects. Turned-on skills are put in front of the agent on every message. Switches are remembered per computer.

## Connecting another agent by hand

Read `~/.duet/session.json`, then point the agent at `http://127.0.0.1:<port>/mcp` with the header `Authorization: Bearer <token>`. The port and token change every time Duet starts.

## Checked

On 8 October 2026, Claude Code 2.1.293, started with the same settings the chat uses, connected, read an empty canvas, and built a frame with a rounded button and a centred label. Antigravity 1.3.1 connected through the bridge and read the canvas. The bad-token, wrong-path, unknown-tool and missing-id cases all return clear errors.

## How each tool is connected

- **Claude Code**: `--mcp-config` and `--append-system-prompt-file`, both pointing at private files in `~/.duet/agent-workspace/`.
- **Antigravity**: only reads MCP servers from its global list. Duet adds one entry, `duet`, the first time you use it (`agy mcp add duet <duet app> --mcp-bridge`). The entry runs the Duet app itself as a tiny stdio bridge that finds the running Duet through `~/.duet/session.json`, so the changing port and token never need updating. Instructions go in with the message. Follow-up messages use `--conversation <id>`.
- **Antigravity (`agy`)**: runs non-interactively with `--output-format stream-json`, but MCP servers can only be added to the user's global configuration with `agy mcp add`. Duet will not change global settings without asking, so it is not connected yet. It also ships many built-in tools (browser, shell) that Duet cannot turn off.
- **Codex, OpenCode**: detected, not connected yet.

## Not done yet

- Antigravity, Codex and OpenCode, as above.
- Windows. The agent is started through `cmd`, which is untested.
- Reading the canvas as an image, so the agent can judge its own work visually.
- A bridge program for agents that only speak over stdio.
