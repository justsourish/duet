import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../project/project";

/** How to reach Duet from an AI that runs outside it. Each one is set up once, with one paste. */

interface Way {
  name: string;
  where: string;
  text: (app: string) => string;
}

const entry = (app: string) => `"duet": ${JSON.stringify({ command: app, args: ["--mcp-bridge"] })}`;

export const WAYS: Way[] = [
  { name: "Claude Code", where: "Paste into a terminal, then start Claude Code.", text: (app) => `claude mcp add --scope user duet -- "${app}" --mcp-bridge` },
  { name: "Codex", where: "Paste into a terminal, then start Codex.", text: (app) => `codex mcp add duet -- "${app}" --mcp-bridge` },
  { name: "Claude desktop app", where: 'Settings, Developer, Edit Config. Paste inside "mcpServers", then restart Claude.', text: entry },
  { name: "Cursor", where: 'Settings, MCP, Add new global MCP server. Paste inside "mcpServers".', text: entry },
];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
}

export default function ConnectAi() {
  const [app, setApp] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (inTauri()) void invoke<string>("bridge_command").then(setApp).catch(() => undefined);
  }, []);
  return (
    <div className="connect">
      <div className="connect-lead">
        Work on this design from an AI outside Duet. Set it up once, and keep Duet open while you work. It follows the same Suggest, Ask first and Auto
        setting as this chat, and what it changes shows as Duet's steps in your history.
      </div>
      {WAYS.map((w) => (
        <div key={w.name} className="connect-way">
          <div>
            <b>{w.name}</b>
            <span>{w.where}</span>
          </div>
          <button
            className="mini"
            disabled={!app}
            onClick={() => {
              void copy(w.text(app));
              setCopied(w.name);
              setTimeout(() => setCopied((c) => (c === w.name ? "" : c)), 1600);
            }}
          >
            {copied === w.name ? "Copied" : "Copy setup"}
          </button>
        </div>
      ))}
    </div>
  );
}
