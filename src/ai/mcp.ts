import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { outsideRules } from "./rules";
import { outsideWorking } from "./outside";
import { TOOLS, callTool } from "./tools";
import { fromChat, OUTSIDE, toolName } from "./who";

/** Answers the questions agents ask over MCP. Duet owns the design, so the answers come from here. */

interface Rpc {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

let version = "";
/** Tools for building Duet itself. Only the build Duet is developed with loads them. */
let builder: typeof import("./builder") | null = null;

/** `client` is what the AI tool calls itself, passed on by the bridge or set by Duet's own chat. */
async function answer(rpc: Rpc, client?: string | null): Promise<unknown> {
  switch (rpc.method) {
    case "initialize":
      return {
        protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "duet", version },
        // an AI that connects from outside reads how to work here; Duet's own chat is told the same
        instructions: outsideRules(),
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: builder ? [...TOOLS, ...builder.BUILDER_TOOLS] : TOOLS };
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = toolName(client);
      // a step remembers who made it, and whether that AI worked from its own window
      const by = tool && !fromChat(client) ? tool + OUTSIDE : tool;
      // only a change counts as working: looking at the design, or a builder tool, does not
      if (tool && !fromChat(client) && !/^(get_|look_|select_|dev_)/.test(name)) outsideWorking(tool);
      const result = builder?.isBuilderTool(name) ? await builder.callBuilderTool(name, rpc.params?.arguments, by) : await callTool(name, rpc.params?.arguments, by);
      const content: Record<string, unknown>[] = [{ type: "text", text: result.text }];
      if (result.image) content.push({ type: "image", data: result.image.data, mimeType: result.image.mime });
      return { content, isError: !!result.isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${rpc.method}`), { code: -32601 });
  }
}

export async function startMcp(): Promise<() => void> {
  version = await getVersion().catch(() => "");
  if (import.meta.env.DEV) {
    builder = await import("./builder");
    builder.watchErrors();
  }
  // The bridge answers from this while Duet is closed, so an outside AI tool that starts first
  // still learns what Duet can do, and only has to be told to open Duet.
  void invoke("write_agent_file", { name: "bridge.json", body: JSON.stringify({ version, instructions: outsideRules(), tools: TOOLS }) }).catch(() => undefined);
  const stop = await listen<{ id: number; body: Rpc; client?: string | null }>("mcp-request", async (e) => {
    const { id, body, client } = e.payload;
    let response: unknown;
    try {
      response = { jsonrpc: "2.0", id: body.id, result: await answer(body, client) };
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603;
      response = { jsonrpc: "2.0", id: body.id, error: { code, message: (err as Error).message } };
    }
    await invoke("mcp_reply", { id, response: JSON.stringify(response) });
  });
  await invoke("mcp_ready");
  return stop;
}
