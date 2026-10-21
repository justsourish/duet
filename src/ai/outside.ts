import { addMsg, getChat, removeWorking, updateMsg } from "./chat";

/** How long after its last change an AI tool working from its own window still counts as working. */
const QUIET = 6000;
let line: number | null = null;
let last: { name: string; at: number } | null = null;

/** The AI tool that changed the design from outside within the last while, if one did. */
export function busyOutside(within = 120000): string | null {
  return last && Date.now() - last.at < within ? last.name : null;
}
let timer: ReturnType<typeof setTimeout> | undefined;

let seen: { name: string; at: number } | null = null;

/** The AI tool that looked at or changed the design from outside within the last while, if one did. */
export function seenOutside(within = 120000): string | null {
  return seen && Date.now() - seen.at < within ? seen.name : null;
}

/** An AI tool outside the chat has just done something, or only looked. Say who, until it has been quiet for a while. */
export function outsideWorking(name: string, looking = false) {
  seen = { name, at: Date.now() };
  if (!looking) last = { name, at: Date.now() };
  // the chat's own tool has its own line, and the two must not fight over it
  if (getChat().running) return;
  // a look in the middle of making changes does not take back that it is working
  const text = looking && !(last?.name === name && Date.now() - last.at < QUIET) ? `${name} is looking at the design from its own window` : `${name} is working from its own window`;
  if (line !== null && getChat().messages.some((m) => m.id === line)) updateMsg(line, { text });
  else line = addMsg({ role: "working", text });
  clearTimeout(timer);
  timer = setTimeout(() => {
    line = null;
    if (!getChat().running) removeWorking();
  }, QUIET);
}
