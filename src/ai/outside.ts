import { addMsg, getChat, removeWorking, updateMsg } from "./chat";

/** How long after its last change an AI tool working from its own window still counts as working. */
const QUIET = 6000;
let line: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** An AI tool outside the chat has just done something. Say who, until it has been quiet for a while. */
export function outsideWorking(name: string) {
  // the chat's own tool has its own line, and the two must not fight over it
  if (getChat().running) return;
  const text = `${name} is working from its own window`;
  if (line !== null && getChat().messages.some((m) => m.id === line)) updateMsg(line, { text });
  else line = addMsg({ role: "working", text });
  clearTimeout(timer);
  timer = setTimeout(() => {
    line = null;
    if (!getChat().running) removeWorking();
  }, QUIET);
}
