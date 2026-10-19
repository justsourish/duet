import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { saveNow, tabName } from "../project/project";
import {
  AGENTS,
  addMsg,
  declineAllWaiting,
  dropSession,
  conversationProject,
  getChat,
  messagesOf,
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
import { FROM_CHAT, OUTSIDE } from "./who";
import { chatRules } from "./rules";
import { aiStarted, bindAi } from "./tools";

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
  save_skill: "Saving your rules as a skill",
};

let sawText = false;
/** When this turn began, and the last message before it, to tell afterwards how the turn went. */
let turn: { at: number; after: number; tool: string; model?: string } | null = null;
let stderrLines: string[] = [];
let workingId: number | null = null;
/** False once the designer has stopped the AI. What it says after that is not shown. */
let live = false;
/** The project whose conversation this turn belongs to. It keeps working there while another project is on screen. */
let runFor = "";

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
    if (typeof ev.session_id === "string") setSessionId(ev.session_id, runFor);
    const servers = (ev.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
    const duet = servers.find((s) => s.name === "duet");
    if (duet && duet.status !== "connected") {
      removeWorking(runFor);
      addMsg({ role: "error", text: "The AI could not connect to your canvas. Try again in a moment." }, runFor);
    }
    return;
  }

  if (ev.type === "assistant") {
    const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        removeWorking(runFor);
        workingId = null;
        sawText = true;
        addMsg({ role: "duet", text: block.text.trim(), by: speaker() }, runFor);
      } else if (block.type === "tool_use") {
        const tool = String(block.name ?? "").replace(/^mcp__duet__/, "");
        const text = `${WORKING[tool] ?? "Working"}...`;
        if (workingId !== null && messagesOf(runFor).some((m) => m.id === workingId)) updateMsg(workingId, { text }, runFor);
        else workingId = addMsg({ role: "working", text }, runFor);
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
    if (typeof ev.session_id === "string") setSessionId(ev.session_id, runFor);
    const text = typeof ev.result === "string" ? ev.result.trim() : "";
    if (ev.is_error) {
      removeWorking(runFor);
      addMsg({ role: "error", text: friendly(text || stderrLines.join(" ")) }, runFor);
      sawText = true;
    } else if (!sawText && text) {
      removeWorking(runFor);
      addMsg({ role: "duet", text, by: speaker() }, runFor);
      sawText = true;
    }
  }
}


// ---- Antigravity: streams small pieces of text, tool steps, then a result ----

let streamId: number | null = null;
let lastStreamId: number | null = null;

function streamText(piece: string) {
  removeWorking(runFor);
  workingId = null;
  sawText = true;
  if (streamId !== null && messagesOf(runFor).some((m) => m.id === streamId)) {
    const cur = messagesOf(runFor).find((m) => m.id === streamId);
    updateMsg(streamId, { text: (cur?.text ?? "") + piece }, runFor);
  } else {
    streamId = addMsg({ role: "duet", text: piece.replace(/^\s+/, ""), by: speaker() }, runFor);
  }
  lastStreamId = streamId;
}

function showWorking(text: string) {
  if (workingId !== null && messagesOf(runFor).some((m) => m.id === workingId)) updateMsg(workingId, { text }, runFor);
  else workingId = addMsg({ role: "working", text }, runFor);
}

function onAgyLine(line: string) {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (ev.event === "init" && typeof ev.conversation_id === "string") {
    setSessionId(ev.conversation_id, runFor);
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
    if (typeof r.conversation_id === "string") setSessionId(r.conversation_id, runFor);
    if (r.status !== "SUCCESS") {
      removeWorking(runFor);
      const err = typeof r.error === "string" ? r.error : typeof r.response === "string" ? r.response : "";
      addMsg({ role: "error", text: friendly(err || stderrLines.join(" ")) }, runFor);
      sawText = true;
    } else if (!sawText && typeof r.response === "string" && r.response.trim()) {
      removeWorking(runFor);
      addMsg({ role: "duet", text: r.response.trim(), by: speaker() }, runFor);
      sawText = true;
    } else if (typeof r.response === "string" && r.response.trim() && lastStreamId !== null) {
      // Streamed pieces can get lost on the way in. The final result holds the whole reply, so
      // if the last message on screen is a shorter start of it, show the full text instead.
      const full = r.response.trim();
      const cur = messagesOf(runFor).find((m) => m.id === lastStreamId);
      const shown = (cur?.text ?? "").trim();
      if (cur && shown.length < full.length && full.startsWith(shown.slice(0, Math.min(20, shown.length)))) {
        updateMsg(lastStreamId, { text: full }, runFor);
      }
    }
  }
}

/** The turn is over: put on the AI's last reply how long it took and how many changes it made. */
function noteTook() {
  const t = turn;
  turn = null;
  if (!t) return;
  const since = messagesOf(runFor).filter((m) => m.id > t.after);
  const changes = since.filter((m) => m.role === "note" && !!m.step).length;
  const reply = [...since].reverse().find((m) => m.role === "duet");
  if (reply) updateMsg(reply.id, { took: { tool: t.tool, ...(t.model ? { model: t.model } : {}), ms: Date.now() - t.at, changes } }, runFor);
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
    removeWorking(runFor);
    declineAllWaiting();
    setRunning(false);
    sessionUsed(false, runFor);
    noteTook();
    if (!sawText) {
      const detail = stderrLines.filter((l) => !/job control|no tty/i.test(l)).join(" ");
      addMsg({ role: "error", text: friendly(detail) }, runFor);
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
  const away = getChat().busy;
  if (away !== null) {
    addMsg({ role: "note", text: `The AI is still at work in ${away ? `"${tabName(away)}"` : "another design"}. It can start here once it is done there.` });
    return;
  }
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
  runFor = conversationProject();
  setRunning(true);
  // some tools reach Duet through its bridge and look like they work from outside: tie both to this project
  const name = speaker() ?? agent;
  bindAi(name, runFor || null);
  bindAi(name + OUTSIDE, runFor || null);
  turn = { at: Date.now(), after: getChat().messages.reduce((n, m) => Math.max(n, m.id), 0), tool: speaker() ?? agent, model: getChat().models[agent] ?? undefined };
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
    let agyInput = "";

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
      // The instructions and the message go in through the input, not the command line: on Windows a
      // command line stops at about 8,000 letters, and the instructions with skills are twice that.
      agyInput = JSON.stringify({ event: "user", message: { role: "user", content: whole } }) + "\n";
      args = ["--print=", "--input-format", "stream-json", "--output-format", "stream-json"];
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
    await invoke("agent_run", { program: agent, args, input: agent === "agy" ? agyInput : `${past}${prompt}`, cwd: `${home}/agent-workspace` });
  } catch (e) {
    live = false;
    removeWorking(runFor);
    setRunning(false);
    addMsg({ role: "error", text: friendly(String(e)) }, runFor);
  }
}

export async function stopAgent() {
  const stopping = runFor;
  try {
    await invoke("agent_cancel");
  } catch {
    /* nothing running */
  }
  // The run normally ends when the tool's output closes. A helper the tool left behind can keep it
  // open, and Stop would look dead, so if the end has not come, end it here.
  await new Promise((r) => setTimeout(r, 1200));
  if (!live || runFor !== stopping) return;
  live = false;
  workingId = null;
  removeWorking(runFor);
  declineAllWaiting();
  setRunning(false);
  addMsg({ role: "note", text: "Stopped." }, runFor);
  void saveNow();
}

/**
 * Before another project is opened. The AI works on whatever design is open, so it must not carry on
 * into the next one. If it is in the middle of something the designer decides: let it finish here,
 * or stop it. Returns false to stay.
 */
export async function readyToLeave(closing = false, project = conversationProject()): Promise<boolean> {
  if (getChat().busy !== project) return true;
  const go = await ask(closing ? "Duet is still working on this design. Stop it and close the project?" : "Duet is still working on this design. Stop it and open the other project?", {
    title: "Duet",
    kind: "warning",
    okLabel: closing ? "Stop and close" : "Stop and open",
    cancelLabel: "Let it finish",
  });
  if (!go) return false;
  // it may have finished while the question was up
  if (getChat().busy !== project) return true;
  live = false;
  await stopAgent();
  removeWorking(runFor);
  workingId = null;
  declineAllWaiting();
  setRunning(false);
  addMsg({ role: "note", text: closing ? "Stopped, because you closed the project." : "Stopped, because you opened another project." }, runFor);
  return true;
}
