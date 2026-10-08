import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { saveNow } from "../project/project";
import {
  AGENTS,
  addMsg,
  declineAllWaiting,
  getChat,
  removeWorking,
  setInstalled,
  setRunning,
  setSessionId,
  updateMsg,
} from "./chat";
import type { AgentId } from "./chat";
import { getSkills } from "./skills";

/** Runs the AI tool the designer already has, and shows what it says as chat. */

const WORKING: Record<string, string> = {
  get_context: "Looking at your design",
  get_document: "Looking at your design",
  select_elements: "Pointing at things",
  create_element: "Adding something",
  set_props: "Changing something",
  move_elements: "Moving things",
  resize_element: "Resizing something",
  reparent_elements: "Moving things between frames",
  delete_elements: "Clearing something away",
};

let sawText = false;
let stderrLines: string[] = [];
let workingId: number | null = null;

/** Look for every AI tool this computer has. */
export async function detectAgent() {
  const found: Partial<Record<AgentId, boolean>> = {};
  await Promise.all(
    AGENTS.map(async (a) => {
      try {
        found[a.id] = await invoke<boolean>("agent_available", { program: a.id });
      } catch {
        found[a.id] = false;
      }
    }),
  );
  setInstalled(found);
}

function systemPrompt(): string {
  const skills = getSkills()
    .filter((s) => s.enabled)
    .map((s) => `<skill name="${s.name}">\n${s.body.trim()}\n</skill>`)
    .join("\n\n");
  return `You are Duet, a design partner working next to a designer inside the Duet design app. You and the designer share one canvas and the same controls.

How you work:
- You can see and change the design only through the Duet tools. Use no other tool, and never read or write files or run commands.
- Start with get_context, and get_document when you need detail. Look before you change anything.
- You cannot see pictures or the design unless you ask. When the designer mentions a photo or an image, or one is selected, call look_at_image before you draw or describe anything from it, and never guess what is in it. After you change a design, call look_at_design once to check your work. Each look costs tokens, so look once, then work from what you saw.
- Make small, clear changes. Prefer one good result over many options, unless asked for options.
- Everything you change is saved as a step in the designer's history, marked as yours, and they can undo it.
- Respect the permission level shown in get_context. If a tool says your change is only a suggestion, do not try to work around it. Say what you suggested.
- Coordinates are pixels. x and y are relative to the parent frame, or to the page for top-level things. Put things inside a frame by giving parentId.
- Names: give new things clear names with set_props, like "Primary button" or "Card title".

How you talk:
- Plain, warm, short. You are talking to a designer, not a programmer.
- Never mention tools, ids, JSON, commands or technical words. Say "I made the button rounder", not "I called set_props".
- After you finish, say in one or two sentences what you did and, if useful, what you would try next.

The designer has loaded these skills. Follow them when they apply:

${skills || "(no skills loaded)"}`;
}

function onClaudeLine(line: string) {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // shell start-up noise, not a message
  }

  if (ev.type === "system" && ev.subtype === "init") {
    if (typeof ev.session_id === "string") setSessionId(ev.session_id);
    const servers = (ev.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
    const duet = servers.find((s) => s.name === "duet");
    if (duet && duet.status !== "connected") {
      removeWorking();
      addMsg({ role: "error", text: "The AI could not connect to your canvas. Try again in a moment." });
    }
    return;
  }

  if (ev.type === "assistant") {
    const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        removeWorking();
        workingId = null;
        sawText = true;
        addMsg({ role: "duet", text: block.text.trim() });
      } else if (block.type === "tool_use") {
        const tool = String(block.name ?? "").replace(/^mcp__duet__/, "");
        const text = `${WORKING[tool] ?? "Working"}...`;
        if (workingId !== null && getChat().messages.some((m) => m.id === workingId)) updateMsg(workingId, { text });
        else workingId = addMsg({ role: "working", text });
      }
    }
    return;
  }

  if (ev.type === "result") {
    if (typeof ev.session_id === "string") setSessionId(ev.session_id);
    const text = typeof ev.result === "string" ? ev.result.trim() : "";
    if (ev.is_error) {
      removeWorking();
      addMsg({ role: "error", text: friendly(text || stderrLines.join(" ")) });
      sawText = true;
    } else if (!sawText && text) {
      removeWorking();
      addMsg({ role: "duet", text });
      sawText = true;
    }
  }
}


// ---- Antigravity: streams small pieces of text, tool steps, then a result ----

let streamId: number | null = null;

function streamText(piece: string) {
  removeWorking();
  workingId = null;
  sawText = true;
  if (streamId !== null && getChat().messages.some((m) => m.id === streamId)) {
    const cur = getChat().messages.find((m) => m.id === streamId);
    updateMsg(streamId, { text: (cur?.text ?? "") + piece });
  } else {
    streamId = addMsg({ role: "duet", text: piece.replace(/^\s+/, "") });
  }
}

function showWorking(text: string) {
  if (workingId !== null && getChat().messages.some((m) => m.id === workingId)) updateMsg(workingId, { text });
  else workingId = addMsg({ role: "working", text });
}

function onAgyLine(line: string) {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (ev.event === "init" && typeof ev.conversation_id === "string") {
    setSessionId(ev.conversation_id);
  } else if (ev.event === "step_update") {
    const step = ev.step_update as Record<string, unknown> | undefined;
    if (!step) return;
    if (step.step_type === "agent_response") {
      if (step.state === "ACTIVE" && typeof step.text_delta === "string") streamText(step.text_delta);
      else if (step.state === "DONE") streamId = null;
    } else if (step.step_type === "tool" && step.state === "ACTIVE") {
      streamId = null;
      const info = step.tool_info as { parameters?: { ToolName?: string } } | undefined;
      if (step.tool_name === "call_mcp_tool") {
        showWorking(`${WORKING[String(info?.parameters?.ToolName ?? "")] ?? "Working"}...`);
      } else {
        // Antigravity can reach for its own tools too. Say so, so nothing happens out of sight.
        showWorking(`Antigravity is using its own tool (${String(step.tool_name ?? "unknown")})...`);
      }
    }
  } else if (ev.event === "result") {
    streamId = null;
    const r = (ev.result ?? {}) as Record<string, unknown>;
    if (typeof r.conversation_id === "string") setSessionId(r.conversation_id);
    if (r.status !== "SUCCESS") {
      removeWorking();
      const err = typeof r.error === "string" ? r.error : typeof r.response === "string" ? r.response : "";
      addMsg({ role: "error", text: friendly(err || stderrLines.join(" ")) });
      sawText = true;
    } else if (!sawText && typeof r.response === "string" && r.response.trim()) {
      removeWorking();
      addMsg({ role: "duet", text: r.response.trim() });
      sawText = true;
    }
  }
}

function onLine(line: string) {
  if (getChat().agent === "agy") onAgyLine(line);
  else onClaudeLine(line);
}

/** Turn technical failures into something a designer can act on. */
function friendly(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("login") || t.includes("authenticat") || t.includes("api key") || t.includes("sign in"))
    return "Your AI tool is not signed in. Open a terminal, run it once, sign in, then try again.";
  if (t.includes("rate") || t.includes("limit") || t.includes("usage"))
    return "Your AI tool says you have hit its usage limit. Try again a little later.";
  if (t.includes("not found") || t.includes("command not found"))
    return "Duet could not find your AI tool. Check that it is installed.";
  return raw ? `Something went wrong: ${raw.slice(0, 240)}` : "Something went wrong and the AI stopped.";
}

export async function startAgentListeners(): Promise<() => void> {
  const offLine = await listen<string>("agent-line", (e) => onLine(e.payload));
  const offErr = await listen<string>("agent-stderr", (e) => {
    stderrLines = [...stderrLines.slice(-5), e.payload];
  });
  const offExit = await listen<number | null>("agent-exit", (e) => {
    removeWorking();
    workingId = null;
    declineAllWaiting();
    setRunning(false);
    if (!sawText) {
      const detail = stderrLines.filter((l) => !/job control|no tty/i.test(l)).join(" ");
      addMsg({ role: "error", text: friendly(detail) });
    }
    void saveNow();
    void e;
  });
  return () => {
    offLine();
    offErr();
    offExit();
  };
}

export async function sendToAgent(text: string) {
  const prompt = text.trim();
  if (!prompt || getChat().running) return;
  const agent = getChat().agent;
  addMsg({ role: "you", text: prompt });
  setRunning(true);
  sawText = false;
  streamId = null;
  stderrLines = [];
  workingId = addMsg({ role: "working", text: "Thinking..." });
  try {
    const info = await invoke<{ port: number; token: string }>("mcp_info");
    const home = await invoke<string>("duet_home");
    const url = `http://127.0.0.1:${info.port}/mcp`;
    const headers = { Authorization: `Bearer ${info.token}` };
    const session = getChat().sessionId;
    let args: string[];

    if (agent === "agy") {
      // Antigravity has no flag for instructions or per-run connections. Duet joins its list once
      // (a small bridge that finds the running Duet), and the instructions go in with the message.
      await invoke("agy_connect");
      const brief = `${systemPrompt()}\n\nFor this job use only the "duet" tools. Do not run commands, browse, or read or write files.\n\nThe designer says:\n${prompt}`;
      args = ["--print", brief, "--output-format", "stream-json"];
      if (session) args.push("--conversation", session);
    } else {
      const files = await invoke<{ system: string; mcp: string }>("write_agent_files", {
        system: systemPrompt(),
        mcp: JSON.stringify({ mcpServers: { duet: { type: "http", url, headers } } }),
      });
      args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        files.mcp,
        "--allowedTools",
        "mcp__duet",
        "--append-system-prompt-file",
        files.system,
      ];
      if (session) args.push("--resume", session);
    }
    await invoke("agent_run", { program: agent, args, input: prompt, cwd: `${home}/agent-workspace` });
  } catch (e) {
    removeWorking();
    setRunning(false);
    addMsg({ role: "error", text: friendly(String(e)) });
  }
}

export async function stopAgent() {
  try {
    await invoke("agent_cancel");
  } catch {
    /* nothing running */
  }
}
