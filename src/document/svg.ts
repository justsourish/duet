import { assetUrl } from "../project/assets";
import { pathData, toAbs } from "./path";
import type { Doc, El } from "./types";

const LINE_HEIGHT = 1.3;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** A colour like #00000040 (colour plus transparency) as SVG wants it. */
function colour(c: string): { color: string; opacity: number } {
  if (/^#[0-9a-f]{8}$/i.test(c)) return { color: c.slice(0, 7), opacity: parseInt(c.slice(7), 16) / 255 };
  return { color: c, opacity: 1 };
}

/** Turn one element, with everything inside it, into a standalone SVG picture. */
export function toSvg(doc: Doc, id: string): string {
  const root = doc.elements[id];
  if (!root) throw new Error("Nothing to export.");
  const defs: string[] = [];
  let n = 0;

  const draw = (el: El, dx: number, dy: number): string => {
    const x = dx + el.x;
    const y = dy + el.y;
    const op = el.opacity < 1 ? ` opacity="${num(el.opacity)}"` : "";

    if (el.type === "text") {
      const lines = el.text.split("\n");
      const spans = lines
        .map((l, i) => `<tspan x="${num(x)}" y="${num(y + i * el.fontSize * LINE_HEIGHT)}">${esc(l)}</tspan>`)
        .join("");
      return `<text font-family="${esc(FONT)}" font-size="${num(el.fontSize)}" fill="${esc(el.fill)}" dominant-baseline="text-before-edge"${op}>${spans}</text>`;
    }

    if (el.type === "image") {
      const url = assetUrl(el.src);
      const r0 = Math.max(0, Math.min(el.radius, el.width / 2, el.height / 2));
      const cid = `c${n++}`;
      defs.push(`<clipPath id="${cid}"><rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r0 ? ` rx="${num(r0)}"` : ""}/></clipPath>`);
      if (!url) return "";
      return `<g${op}><image href="${esc(url)}" x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/></g>`;
    }

    if (el.type === "group") {
      const kids = el.childIds
        .map((c) => doc.elements[c])
        .filter(Boolean)
        .map((c) => draw(c, x, y))
        .join("");
      return `<g${op}>${kids}</g>`;
    }

    if (el.type === "path") {
      const nodes = toAbs(el, x, y);
      if (nodes.length < 2) return "";
      const stroke = el.stroke && el.strokeWidth > 0 ? ` stroke="${esc(el.stroke)}" stroke-width="${num(el.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"` : "";
      let pfill = el.closed ? esc(el.fill) : "none";
      if (el.closed && el.gradient) {
        const g = el.gradient;
        const a = (g.angle * Math.PI) / 180;
        const cx = x + el.width / 2;
        const cy = y + el.height / 2;
        const half = (Math.abs(el.width * Math.cos(a)) + Math.abs(el.height * Math.sin(a))) / 2;
        const gid = `g${n++}`;
        defs.push(
          `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(cx - Math.cos(a) * half)}" y1="${num(cy - Math.sin(a) * half)}" x2="${num(cx + Math.cos(a) * half)}" y2="${num(cy + Math.sin(a) * half)}"><stop offset="0" stop-color="${esc(g.from)}"/><stop offset="1" stop-color="${esc(g.to)}"/></linearGradient>`,
        );
        pfill = `url(#${gid})`;
      }
      let pfilter = "";
      if (el.shadow) {
        const c = colour(el.shadow.color);
        const fid = `s${n++}`;
        defs.push(
          `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(el.shadow.x)}" dy="${num(el.shadow.y)}" stdDeviation="${num(el.shadow.blur / 2)}" flood-color="${esc(c.color)}" flood-opacity="${num(c.opacity)}"/></filter>`,
        );
        pfilter = ` filter="url(#${fid})"`;
      }
      return `<path d="${pathData(nodes, el.closed)}" fill="${pfill}"${stroke}${pfilter}${op}/>`;
    }

    let fill = esc(el.fill);
    if (el.gradient) {
      const g = el.gradient;
      const a = (g.angle * Math.PI) / 180;
      const cx = x + el.width / 2;
      const cy = y + el.height / 2;
      const half = (Math.abs(el.width * Math.cos(a)) + Math.abs(el.height * Math.sin(a))) / 2;
      const gid = `g${n++}`;
      defs.push(
        `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(cx - Math.cos(a) * half)}" y1="${num(cy - Math.sin(a) * half)}" x2="${num(cx + Math.cos(a) * half)}" y2="${num(cy + Math.sin(a) * half)}"><stop offset="0" stop-color="${esc(g.from)}"/><stop offset="1" stop-color="${esc(g.to)}"/></linearGradient>`,
      );
      fill = `url(#${gid})`;
    }
    let filter = "";
    if (el.shadow) {
      const c = colour(el.shadow.color);
      const fid = `s${n++}`;
      defs.push(
        `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(el.shadow.x)}" dy="${num(el.shadow.y)}" stdDeviation="${num(el.shadow.blur / 2)}" flood-color="${esc(c.color)}" flood-opacity="${num(c.opacity)}"/></filter>`,
      );
      filter = ` filter="url(#${fid})"`;
    }
    const stroke = el.stroke && el.strokeWidth > 0 ? ` stroke="${esc(el.stroke)}" stroke-width="${num(el.strokeWidth)}"` : "";
    const r = Math.max(0, Math.min(el.radius, el.width / 2, el.height / 2));
    const shape =
      el.type === "ellipse"
        ? `<ellipse cx="${num(x + el.width / 2)}" cy="${num(y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}" fill="${fill}"${stroke}${filter}/>`
        : `<rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r ? ` rx="${num(r)}"` : ""} fill="${fill}"${stroke}${filter}/>`;

    if (!el.childIds.length) return op ? `<g${op}>${shape}</g>` : shape;

    const cid = `c${n++}`;
    defs.push(
      el.type === "ellipse"
        ? `<clipPath id="${cid}"><ellipse cx="${num(x + el.width / 2)}" cy="${num(y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}"/></clipPath>`
        : `<clipPath id="${cid}"><rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r ? ` rx="${num(r)}"` : ""}/></clipPath>`,
    );
    const kids = el.childIds
      .map((c) => doc.elements[c])
      .filter(Boolean)
      .map((c) => draw(c, x, y))
      .join("");
    return `<g${op}>${shape}<g clip-path="url(#${cid})">${kids}</g></g>`;
  };

  // draw the element at the top-left corner of the picture
  const body = draw({ ...root, x: 0, y: 0 }, 0, 0);
  const w = num(root.width);
  const h = num(root.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body}</svg>\n`;
}
