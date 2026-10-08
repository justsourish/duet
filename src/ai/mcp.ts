import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TOOLS, callTool } from "./tools";

/** Answers the questions agents ask over MCP. Duet owns the design, so the answers come from here. */

interface Rpc {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

async function answer(rpc: Rpc): Promise<unknown> {
  switch (rpc.method) {
    case "initialize":
      return {
        protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "duet", version: "0.1.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const result = await callTool(name, rpc.params?.arguments);
      return { content: [{ type: "text", text: result.text }], isError: !!result.isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${rpc.method}`), { code: -32601 });
  }
}

export async function startMcp(): Promise<() => void> {
  const stop = await listen<{ id: number; body: Rpc }>("mcp-request", async (e) => {
    const { id, body } = e.payload;
    let response: unknown;
    try {
      response = { jsonrpc: "2.0", id: body.id, result: await answer(body) };
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603;
      response = { jsonrpc: "2.0", id: body.id, error: { code, message: (err as Error).message } };
    }
    await invoke("mcp_reply", { id, response: JSON.stringify(response) });
  });
  return stop;
}
