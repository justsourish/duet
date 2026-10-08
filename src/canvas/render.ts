import { worldRect } from "../document/geometry";
import { toAbs, trace } from "../document/path";
import type { Doc, El, Rect } from "../document/types";
import { currentDoc } from "../state/store";
import type { State } from "../state/store";
import { logError } from "../errorLog";
import { getPicture } from "../project/assets";
import { HANDLES } from "./handles";
import { FONT_STACK, LINE_HEIGHT, measureText } from "./text";

export const COLORS = {
  bg: "#141417",
  dot: "#2a2a31",
  accent: "#7c5cff",
  guide: "#22d3ee",
  muted: "#8d8d98",
  white: "#ffffff",
};

const toScreen = (s: State, wx: number, wy: number) => ({
  x: wx * s.viewport.zoom + s.viewport.x,
  y: wy * s.viewport.zoom + s.viewport.y,
});

export function screenRect(s: State, r: Rect): Rect {
  const p = toScreen(s, r.x, r.y);
  return { x: p.x, y: p.y, width: r.width * s.viewport.zoom, height: r.height * s.viewport.zoom };
}

/** What is written above a screen on the canvas. A diamond marks components and their copies. */
export const labelText = (el: El) => (el.component ? `◆ ${el.name}` : el.type === "instance" ? `◇ ${el.name}` : el.name);

export function labelRect(s: State, doc: Doc, id: string): Rect {
  const el = doc.elements[id];
  const sr = screenRect(s, worldRect(doc, id));
  const w = measureText(labelText(el), 12).width + 6;
  return { x: sr.x, y: sr.y - 20, width: w, height: 18 };
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr > 0) ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

/** Gradient between two colours across a box, at an angle in degrees. */
export function makeGradient(ctx: CanvasRenderingContext2D, g: NonNullable<El["gradient"]>, x: number, y: number, w: number, h: number) {
  const a = (g.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  grad.addColorStop(0, g.from);
  grad.addColorStop(1, g.to);
  return grad;
}

/** A drawn line: filled if it is closed, stroked, with an optional shadow. */
function drawLine(ctx: CanvasRenderingContext2D, el: El, x: number, y: number) {
  const nodes = toAbs(el, x, y);
  if (nodes.length < 2) return;
  ctx.beginPath();
  trace(ctx, nodes, el.closed);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const shadow = () => {
    if (!el.shadow) return;
    const k = ctx.getTransform().a;
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur * k;
    ctx.shadowOffsetX = el.shadow.x * k;
    ctx.shadowOffsetY = el.shadow.y * k;
  };
  const noShadow = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
  if (el.closed) {
    ctx.fillStyle = el.gradient ? makeGradient(ctx, el.gradient, x, y, el.width, el.height) : el.fill;
    shadow();
    ctx.fill();
    noShadow();
  }
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    if (!el.closed) shadow();
    ctx.stroke();
    noShadow();
  }
}

/** A picture, filled into its box without stretching (the extra is cropped), with rounded corners and a shadow. */
function drawImage(ctx: CanvasRenderingContext2D, el: El, x: number, y: number) {
  const pic = getPicture(el.src);
  roundedPath(ctx, x, y, el.width, el.height, el.radius);
  if (el.shadow) {
    const k = ctx.getTransform().a;
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur * k;
    ctx.shadowOffsetX = el.shadow.x * k;
    ctx.shadowOffsetY = el.shadow.y * k;
  }
  ctx.fillStyle = pic ? "#ffffff" : "#2a2a31";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (pic && pic.naturalWidth > 0 && pic.naturalHeight > 0) {
    ctx.save();
    try {
      roundedPath(ctx, x, y, el.width, el.height, el.radius);
      ctx.clip();
      const scale = Math.max(el.width / pic.naturalWidth, el.height / pic.naturalHeight);
      const w = pic.naturalWidth * scale;
      const h = pic.naturalHeight * scale;
      ctx.drawImage(pic, x + (el.width - w) / 2, y + (el.height - h) / 2, w, h);
    } catch (e) {
      logError("draw picture", e);
    } finally {
      ctx.restore();
    }
  }
  if (el.stroke && el.strokeWidth > 0) {
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.stroke();
  }
}

/** Draw an element and everything inside it. ox and oy are where its parent sits. */
export function drawElement(ctx: CanvasRenderingContext2D, doc: Doc, el: El, ox: number, oy: number) {
  const x = ox + el.x;
  const y = oy + el.y;
  ctx.save();
  ctx.globalAlpha *= el.opacity;

  if (el.type === "text") {
    ctx.fillStyle = el.fill;
    ctx.font = `400 ${el.fontSize}px ${FONT_STACK}`;
    ctx.textBaseline = "top";
    el.text.split("\n").forEach((line, i) => ctx.fillText(line, x, y + i * el.fontSize * LINE_HEIGHT));
    ctx.restore();
    return;
  }

  if (el.type === "group") {
    for (const id of el.childIds) {
      const child = doc.elements[id];
      if (child) drawElement(ctx, doc, child, x, y);
    }
    ctx.restore();
    return;
  }

  if (el.type === "path") {
    drawLine(ctx, el, x, y);
    ctx.restore();
    return;
  }

  if (el.type === "image") {
    drawImage(ctx, el, x, y);
    ctx.restore();
    return;
  }

  if (el.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + el.width / 2, y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
  } else {
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
  }
  ctx.fillStyle = el.gradient ? makeGradient(ctx, el.gradient, x, y, el.width, el.height) : el.fill;
  if (el.shadow) {
    // shadow sizes are in screen pixels, so they have to be scaled by the current zoom
    const k = ctx.getTransform().a;
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur * k;
    ctx.shadowOffsetX = el.shadow.x * k;
    ctx.shadowOffsetY = el.shadow.y * k;
  }
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.stroke();
  }

  if (el.childIds.length) {
    ctx.save();
    if (el.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(x + el.width / 2, y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    } else {
      roundedPath(ctx, x, y, el.width, el.height, el.radius);
    }
    ctx.clip();
    for (const id of el.childIds) {
      const child = doc.elements[id];
      if (child) drawElement(ctx, doc, child, x, y);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, s: State, w: number, h: number) {
  const { zoom, x, y } = s.viewport;
  let step = 24;
  while (step * zoom < 14) step *= 2;
  const sp = step * zoom;
  const startX = ((x % sp) + sp) % sp;
  const startY = ((y % sp) + sp) % sp;
  ctx.fillStyle = COLORS.dot;
  for (let px = startX; px < w; px += sp) {
    for (let py = startY; py < h; py += sp) ctx.fillRect(Math.round(px), Math.round(py), 1.5, 1.5);
  }
}

function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  ctx.font = `600 11px ${FONT_STACK}`;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y, w, 18, 5);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y + 9.5);
  ctx.textAlign = "left";
}

export function draw(ctx: CanvasRenderingContext2D, s: State, w: number, h: number, dpr: number) {
  const doc = currentDoc(s);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, s, w, h);

  // world space
  ctx.save();
  ctx.translate(s.viewport.x, s.viewport.y);
  ctx.scale(s.viewport.zoom, s.viewport.zoom);
  for (const id of doc.rootIds) {
    const el = doc.elements[id];
    if (el) drawElement(ctx, doc, el, 0, 0);
  }
  ctx.restore();

  // screen space from here
  ctx.lineWidth = 1;

  // frame names
  ctx.font = `500 12px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  for (const id of doc.rootIds) {
    const el = doc.elements[id];
    if (!el || (el.type !== "frame" && el.type !== "instance")) continue;
    const sr = screenRect(s, worldRect(doc, id));
    ctx.fillStyle = s.selection.includes(id) || el.component ? COLORS.accent : COLORS.muted;
    ctx.fillText(labelText(el), sr.x, sr.y - 7);
  }

  // hover outline
  const hover = s.overlay.hoverId;
  if (hover && doc.elements[hover] && !s.selection.includes(hover) && !s.overlay.draft) {
    const r = screenRect(s, worldRect(doc, hover));
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
  }

  // selection
  const sel = s.selection.filter((id) => doc.elements[id]);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1.5;
  for (const id of sel) {
    const r = screenRect(s, worldRect(doc, id));
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
  if (sel.length === 1 && !s.overlay.nodeEdit) {
    const r = screenRect(s, worldRect(doc, sel[0]));
    for (const hd of HANDLES) {
      const hx = r.x + r.width * hd.fx;
      const hy = r.y + r.height * hd.fy;
      ctx.fillStyle = COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(hx - 4, hy - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (sel.length > 0) {
    const rects = sel.map((id) => screenRect(s, worldRect(doc, id)));
    const x1 = Math.min(...rects.map((r) => r.x));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    const wr = sel.map((id) => worldRect(doc, id));
    const ww = Math.max(...wr.map((r) => r.x + r.width)) - Math.min(...wr.map((r) => r.x));
    const wh = Math.max(...wr.map((r) => r.y + r.height)) - Math.min(...wr.map((r) => r.y));
    pill(ctx, `${Math.round(ww)} × ${Math.round(wh)}`, (x1 + x2) / 2, y2 + 10);
  }

  // the points of a line being edited
  const ne = s.overlay.nodeEdit;
  if (ne && doc.elements[ne.id]?.type === "path") {
    const el = doc.elements[ne.id];
    const at = worldRect(doc, ne.id);
    const nodes = toAbs(el, at.x, at.y).map((n) => {
      const a = toScreen(s, n.x, n.y);
      const z = s.viewport.zoom;
      return { x: a.x, y: a.y, ix: n.ix * z, iy: n.iy * z, ox: n.ox * z, oy: n.oy * z };
    });
    nodes.forEach((n, i) => {
      const chosen = ne.selected === i;
      if (chosen && (n.ox || n.oy || n.ix || n.iy)) {
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x + n.ix, n.y + n.iy);
        ctx.lineTo(n.x, n.y);
        ctx.lineTo(n.x + n.ox, n.y + n.oy);
        ctx.stroke();
        for (const [hx, hy, on] of [[n.x + n.ix, n.y + n.iy, n.ix || n.iy], [n.x + n.ox, n.y + n.oy, n.ox || n.oy]] as const) {
          if (!on) continue;
          ctx.fillStyle = COLORS.white;
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.fillStyle = chosen ? COLORS.accent : COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(n.x - 4, n.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
  }

  // the line being drawn with the pen
  const pen = s.overlay.pen;
  if (pen && pen.nodes.length) {
    const nodes = pen.nodes.map((n) => {
      const a = toScreen(s, n.x, n.y);
      return { x: a.x, y: a.y, ix: n.ix * s.viewport.zoom, iy: n.iy * s.viewport.zoom, ox: n.ox * s.viewport.zoom, oy: n.oy * s.viewport.zoom };
    });
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trace(ctx, nodes, false);
    ctx.stroke();
    if (pen.cursor) {
      // the next piece, from the last point to the pointer
      const last = nodes[nodes.length - 1];
      const c = toScreen(s, pen.cursor.x, pen.cursor.y);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      if (last.ox || last.oy) ctx.bezierCurveTo(last.x + last.ox, last.y + last.oy, c.x, c.y, c.x, c.y);
      else ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    nodes.forEach((n, i) => {
      if (n.ox || n.oy) {
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x + n.ix, n.y + n.iy);
        ctx.lineTo(n.x + n.ox, n.y + n.oy);
        ctx.stroke();
        for (const [hx, hy] of [[n.x + n.ix, n.y + n.iy], [n.x + n.ox, n.y + n.oy]]) {
          ctx.fillStyle = COLORS.accent;
          ctx.beginPath();
          ctx.arc(hx, hy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = i === 0 && nodes.length >= 2 ? COLORS.accent : COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(n.x - 4, n.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
  }

  // draft shape
  if (s.overlay.draft) {
    const r = screenRect(s, s.overlay.draft.rect);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    if (s.overlay.draft.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    }
    pill(ctx, `${Math.round(s.overlay.draft.rect.width)} × ${Math.round(s.overlay.draft.rect.height)}`, r.x + r.width / 2, r.y + r.height + 10);
  }

  // marquee
  if (s.overlay.marquee) {
    const r = screenRect(s, s.overlay.marquee);
    ctx.fillStyle = "rgba(124,92,255,.12)";
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
  }

  // snapping guides
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 1;
  for (const gx of s.overlay.guidesX) {
    const sx = Math.round(toScreen(s, gx, 0).x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (const gy of s.overlay.guidesY) {
    const sy = Math.round(toScreen(s, 0, gy).y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  // empty hint
  if (doc.rootIds.length === 0 && !s.overlay.draft) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 14px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Press F, then drag to draw your first frame", w / 2, h / 2 - 8);
    ctx.font = `400 12px ${FONT_STACK}`;
    ctx.fillText("R rectangle   O ellipse   T text   V move   Space + drag to pan", w / 2, h / 2 + 14);
    ctx.textAlign = "left";
  }
}
