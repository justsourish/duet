# The AI bridge

How agents work inside Duet. Written 8 October 2026.

## The idea

A designer and an AI share the same controls. Every change in Duet is one named command. The interface calls them when you click. Agents call the very same ones through MCP.

## How it is built

- **A local server.** When Duet starts, it opens a small server on `127.0.0.1` at a random port. Only this computer can reach it. A secret token is required on every request. Port and token are written to `~/.duet/session.json` (readable only by the user), and also handed to the interface.
- **MCP over HTTP.** The server speaks MCP (JSON-RPC over POST to `/mcp`): `initialize`, `ping`, `tools/list`, `tools/call`. It does not stream events to the agent, so GET returns 405.
- **The interface owns the design.** The server passes each request to the interface, waits for the answer, and returns it. The design is never held in two places.
- **The chat runs the agent you already have.** Duet starts the agent tool in the background, writes your message to its input, and streams what it says back into the chat. For now that is Claude Code. Tool use is limited to Duet's own tools, so the agent cannot touch files or run commands.

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

On 8 October 2026, Claude Code 2.1.293, started with the same settings the chat uses, connected, read an empty canvas, and built a frame with a rounded button and a centred label. The bad-token, wrong-path, unknown-tool and missing-id cases all return clear errors.

## Not done yet

- Gemini CLI and Antigravity. Each needs its own non-interactive flags checked against the real tool.
- Windows. The agent is started through `cmd`, which is untested.
- Reading the canvas as an image, so the agent can judge its own work visually.
- A bridge program for agents that only speak over stdio.
