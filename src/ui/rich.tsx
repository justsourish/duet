/**
 * What an AI writes often carries marks for bold and code, like **this** and `this`. The chat shows
 * them as bold and code instead of leaving the marks in the text. Nothing else is read into the text.
 */

export interface Part {
  kind: "plain" | "bold" | "code";
  text: string;
}

/** Split a message into plain, bold and code parts. Marks with nothing to close them stay as they are. */
export function richParts(text: string): Part[] {
  const out: Part[] = [];
  const add = (kind: Part["kind"], t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t;
    else out.push({ kind, text: t });
  };
  const mark = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`/g;
  let at = 0;
  for (const m of text.matchAll(mark)) {
    add("plain", text.slice(at, m.index));
    if (m[1] !== undefined) add("bold", m[1]);
    else add("code", m[2]);
    at = m.index + m[0].length;
  }
  add("plain", text.slice(at));
  // a list written with dashes or stars reads better with dots
  for (const p of out) if (p.kind === "plain") p.text = p.text.replace(/(^|\n)([ \t]*)[-*] /g, "$1$2• ");
  return out;
}

export default function Rich({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) => (p.kind === "bold" ? <b key={i}>{p.text}</b> : p.kind === "code" ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
    </>
  );
}
