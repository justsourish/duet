import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { saveNow } from "../project/project";
import {
  AGENTS,
  addMsg,
  declineAllWaiting,
  dropSession,
  getChat,
  removeWorking,
  sendPictures,
  sessionUsed,
  setInstalled,
  setRunning,
  setSessionId,
  updateMsg,
} from "./chat";
import { brief, carryOn, keepable } from "../memory/thread";
import type { AgentId } from "./chat";
import { mentioned, setAgent } from "./chat";
import { FROM_CHAT } from "./who";
import { chatRules } from "./rules";
import { aiStarted } from "./tools";

/** Runs the AI tool the designer already has, and shows what it says as chat. */

const WORKING: Record<string, string> = {
  get_context: "Looking at your design",
  get_outline: "Looking at your design",
  get_document: "Looking at your design",
  look_at_image: "Looking at a picture",
  look_at_design: "Checking how it looks",
  look_at_attachment: "Looking at your picture",
  create_instance: "Placing a copy",
  place_image: "Bringing in a picture",
  make_mask: "Cutting something to a shape",
  trace_image: "Tracing a picture",
  select_elements: "Pointing at things",
  create_element: "Adding something",
  create_elements: "Building a section",
  set_curve: "Shaping a move",
  set_props: "Changing something",
  move_elements: "Moving things",
  resize_element: "Resizing something",
  reparent_elements: "Moving things between frames",
  delete_elements: "Clearing something away",
  duplicate_elements: "Making a copy",
};

let sawText = false;
let stderrLines: string[] = [];
let workingId: number | null = null;
/** False once the designer has left the project the AI was working on. What it says after that is not shown. */
let live = false;

/** The name of the agent that is answering in the chat right now. */
const speaker = () => AGENTS.find((a) => a.id === getChat().agent)?.name;

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
        addMsg({ role: "duet", text: block.text.trim(), by: speaker() });
      } else if (block.type === "tool_use") {
        const tool = String(block.name ?? "").replace(/^mcp__duet__/, "");
        const text = `${WORKING[tool] ?? "Working"}...`;
        if (workingId !== null && getChat().messages.some((m) => m.id === workingId)) updateMsg(workingId, { text });
        else workingId = addMsg({ role: "working", text });
      }
    }
    return;
  }

  // a tool's answer coming back means that tool has finished
  if (ev.type === "user" && workingId !== null) {
    showWorking("Thinking...");
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
      addMsg({ role: "duet", text, by: speaker() });
      sawText = true;
    }
  }
}


// ---- Antigravity: streams small pieces of text, tool steps, then a result ----

let streamId: number | null = null;
let lastStreamId: number | null = null;

function streamText(piece: string) {
  removeWorking();
  workingId = null;
  sawText = true;
  if (streamId !== null && getChat().messages.some((m) => m.id === streamId)) {
    const cur = getChat().messages.find((m) => m.id === streamId);
    updateMsg(streamId, { text: (cur?.text ?? "") + piece });
  } else {
    streamId = addMsg({ role: "duet", text: piece.replace(/^\s+/, ""), by: speaker() });
  }
  lastStreamId = streamId;
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
    } else if (step.step_type === "tool" && step.state === "DONE") {
      // the tool has finished: do not leave its message up as if it were still running
      if (workingId !== null) showWorking("Thinking...");
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
      addMsg({ role: "duet", text: r.response.trim(), by: speaker() });
      sawText = true;
    } else if (typeof r.response === "string" && r.response.trim() && lastStreamId !== null) {
      // Streamed pieces can get lost on the way in. The final result holds the whole reply, so
      // if the last message on screen is a shorter start of it, show the full text instead.
      const full = r.response.trim();
      const cur = getChat().messages.find((m) => m.id === lastStreamId);
      const shown = (cur?.text ?? "").trim();
      if (cur && shown.length < full.length && full.startsWith(shown.slice(0, Math.min(20, shown.length)))) {
        updateMsg(lastStreamId, { text: full });
      }
    }
  }
}

function onLine(line: string) {
  if (!live) return;
  if (getChat().agent === "agy") onAgyLine(line);
  else onClaudeLine(line);
}

/** Turn technical failures into something a designer can act on. */
/** Why Antigravity could not be joined to Duet, in words a designer can act on. */
export function connectHelp(why: string, app: string): string {
  const fix = app ? ` To do it yourself, open a terminal and run this once: agy mcp add duet "${app}" --mcp-bridge` : "";
  const t = why.toLowerCase();
  if (t.includes("could not start agy") || t.includes("not recognized") || t.includes("no such file") || t.includes("cannot find"))
    return `Duet could not start Antigravity (agy). Check that Antigravity is installed and that "agy" works in a terminal, then try again.${fix}`;
  return `Duet could not connect itself to Antigravity.${why.trim() ? ` Antigravity said: ${why.trim().slice(0, 160)}.` : ""}${fix}`;
}

function friendly(raw: string): string {
  // already written for the designer
  if (raw.includes("Duet could not")) return raw.replace(/^Error: /, "");
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
    workingId = null;
    // the designer has moved to another project, and that chat was already tidied
    if (!live) return;
    live = false;
    removeWorking();
    declineAllWaiting();
    setRunning(false);
    sessionUsed();
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
  const said = text.trim();
  if (getChat().running) return;
  if (!said && !getChat().pictures.some((p) => !p.sent)) return;
  // naming an agent with @ hands the message to that one, and it answers from then on
  const asked = mentioned(said, getChat().installed);
  if (asked && asked !== getChat().agent) setAgent(asked);
  const agent = getChat().agent;
  // Duet holds the conversation, not the AI tool. A quick back and forth carries the tool's own session on.
  // Otherwise it starts fresh and light, with a short note from Duet of what was said and done.
  const before = getChat();
  const resume = carryOn({ sessionId: before.sessionId, used: before.sessionUsed, messages: before.sessionMessages });
  if (!resume) dropSession();
  const note = resume ? "" : brief(keepable(before.messages));
  const past = note ? `${note}\n\nThe designer now says:\n` : "";
  const pictures = sendPictures();
  addMsg({ role: "you", text: said, pictures: pictures.length ? pictures.map((p) => p.n) : undefined });
  // The pictures do not travel inside the message. The AI is told they are there and asks to see each one,
  // the same way it looks at the canvas, so every AI tool gets them the same way.
  const what = pictures.every((p) => p.text === undefined) ? "picture" : pictures.every((p) => p.text !== undefined) ? "text file" : "file";
  const attached = pictures.length
    ? `\n\n(The designer attached ${pictures.length === 1 ? `a ${what}` : `${pictures.length} ${what}s`} to this message: ${pictures.map((p) => `number ${p.n}`).join(", ")}. Look at ${pictures.length === 1 ? "it" : "each one"} with look_at_attachment before you do anything else.)`
    : "";
  const prompt = `${said || "Look at what I attached."}${attached}`;
  sessionUsed(true);
  setRunning(true);
  // the designer sees the AI at work on the canvas straight away, not after its first change
  aiStarted(speaker());
  live = true;
  sawText = false;
  streamId = null;
  lastStreamId = null;
  stderrLines = [];
  workingId = addMsg({ role: "working", text: "Thinking..." });
  try {
    const info = await invoke<{ port: number; token: string }>("mcp_info");
    const home = await invoke<string>("duet_home");
    const url = `http://127.0.0.1:${info.port}/mcp`;
    // the name goes with every request, so each step can say which AI tool made it
    const headers = { Authorization: `Bearer ${info.token}`, "X-Duet-Client": `${FROM_CHAT}${AGENTS.find((x) => x.id === agent)?.name ?? agent}` };
    const session = getChat().sessionId;
    let args: string[];

    if (agent === "agy") {
      // Antigravity has no flag for instructions or per-run connections. Duet joins its list once
      // (a small bridge that finds the running Duet), and the instructions go in with the message.
      try {
        await invoke("agy_connect");
      } catch (e) {
        // the AI never started, so say what failed and the one command that fixes it by hand
        const app = await invoke<string>("bridge_command").catch(() => "");
        throw new Error(connectHelp(String(e), app));
      }
      const whole = `${chatRules()}\n\nFor this job use only the "duet" tools. Do not run commands, browse, or read or write files.\n\n${past || "The designer says:\n"}${prompt}`;
      args = ["--print", whole, "--output-format", "stream-json"];
      if (getChat().models.agy) args.push("--model", getChat().models.agy as string);
      // The Antigravity model names already carry their level, e.g. "(High)", so no --effort here.
      if (session) args.push("--conversation", session);
    } else {
      const files = await invoke<{ system: string; mcp: string }>("write_agent_files", {
        system: chatRules(),
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
      if (getChat().models.claude) args.push("--model", getChat().models.claude as string);
      if (getChat().effort) args.push("--effort", getChat().effort);
      if (session) args.push("--resume", session);
    }
    await invoke("agent_run", { program: agent, args, input: agent === "agy" ? prompt : `${past}${prompt}`, cwd: `${home}/agent-workspace` });
  } catch (e) {
    live = false;
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

/**
 * Before another project is opened. The AI works on whatever design is open, so it must not carry on
 * into the next one. If it is in the middle of something the designer decides: let it finish here,
 * or stop it. Returns false to stay.
 */
export async function readyToLeave(closing = false): Promise<boolean> {
  if (!getChat().running) return true;
  const go = await ask(closing ? "Duet is still working on this design. Stop it and close the project?" : "Duet is still working on this design. Stop it and open the other project?", {
    title: "Duet",
    kind: "warning",
    okLabel: closing ? "Stop and close" : "Stop and open",
    cancelLabel: "Let it finish",
  });
  if (!go) return false;
  // it may have finished while the question was up
  if (!getChat().running) return true;
  live = false;
  await stopAgent();
  removeWorking();
  workingId = null;
  declineAllWaiting();
  setRunning(false);
  addMsg({ role: "note", text: closing ? "Stopped, because you closed the project." : "Stopped, because you opened another project." });
  return true;
}
