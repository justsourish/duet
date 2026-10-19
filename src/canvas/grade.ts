import { invoke } from "@tauri-apps/api/core";
import { isNeutral } from "../document/grade";
import type { Grade } from "../document/grade";
import { logError } from "../errorLog";

/**
 * The colour grade on screen. A picture or the current picture of a clip goes through one WebGL2
 * shader that runs the same steps, in the same order, as the export engine (src-tauri/src/grade.rs).
 * The numbers in src/document/grade-fixtures.json are what both must give.
 */

type M3 = number[][];

const mul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const apply = (m: M3, v: number[]) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

function invert(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const RGB_TO_XYZ: M3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const BRADFORD: M3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const DAYLIGHT_K = 6504;

function daylight(k: number): [number, number] {
  k = Math.min(25000, Math.max(4000, k));
  const x = k <= 7000 ? -4.607e9 / k ** 3 + 2.9678e6 / k ** 2 + 0.09911e3 / k + 0.244063 : -2.0064e9 / k ** 3 + 1.9018e6 / k ** 2 + 0.24748e3 / k + 0.23704;
  return [x, -3 * x * x + 2.87 * x - 0.275];
}

/** The white balance as one matrix on linear RGB, rows first. The same as white_balance in grade.rs. */
export function whiteBalance(temperature: number, tint: number): M3 {
  const [fx, fy0] = daylight(DAYLIGHT_K * 2 ** ((temperature / 100) * 0.55));
  const fy = fy0 + (tint / 100) * 0.03;
  const [tx, ty] = daylight(DAYLIGHT_K);
  const cone = (x: number, y: number) => apply(BRADFORD, [x / y, 1, (1 - x - y) / y]);
  const src = cone(fx, fy);
  const dst = cone(tx, ty);
  const scale = [
    [dst[0] / src[0], 0, 0],
    [0, dst[1] / src[1], 0],
    [0, 0, dst[2] / src[2]],
  ];
  const toCone = mul(BRADFORD, RGB_TO_XYZ);
  return mul(invert(toCone), mul(scale, toCone));
}

export const contrastPower = (c: number) => (c >= 0 ? 1 + (c / 100) * 0.6 : 1 + (c / 100) * 0.5);

const VERTEX = `#version 300 es
in vec2 at;
out vec2 uv;
void main() {
  uv = at * 0.5 + 0.5;
  gl_Position = vec4(at, 0.0, 1.0);
}`;

// The same steps as Ready::pixel in grade.rs. Keep the two in step.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D src;
uniform sampler3D cube;
uniform sampler2D curve;
uniform int lookDim;
uniform float lookSize;
uniform vec3 lookMin;
uniform vec3 lookMax;
uniform float lookAmount;
uniform mat3 balance;
uniform float gain;
uniform float contrast;
uniform float shadows;
uniform float highlights;
uniform float whites;
uniform float blacks;
uniform float saturation;
uniform float vibrance;
in vec2 uv;
out vec4 color;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float GREY = 0.18;

vec3 toLinear(vec3 v) {
  return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), v));
}
vec3 toDisplay(vec3 v) {
  v = clamp(v, 0.0, 1.0);
  return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), v));
}
float toneShift(float s) {
  float sh = 1.0 - smoothstep(-4.0, 0.5, s);
  float hi = smoothstep(-0.5, 3.0, s);
  float wh = smoothstep(1.5, 3.5, s);
  float bl = 1.0 - smoothstep(-6.0, -2.5, s);
  return (shadows * sh + highlights * hi) / 100.0 * 1.5 + (whites * wh + blacks * bl) / 100.0;
}
vec3 at3(ivec3 i) {
  return texelFetch(cube, i, 0).rgb;
}
vec3 look(vec3 v) {
  float n = lookSize - 1.0;
  vec3 p = clamp((v - lookMin) / (lookMax - lookMin), 0.0, 1.0) * n;
  if (lookDim == 1) {
    vec3 o;
    for (int c = 0; c < 3; c++) {
      float i = min(floor(p[c]), n - 1.0);
      float f = p[c] - i;
      o[c] = mix(texelFetch(curve, ivec2(int(i), 0), 0)[c], texelFetch(curve, ivec2(int(i) + 1, 0), 0)[c], f);
    }
    return o;
  }
  vec3 i = min(floor(p), vec3(n - 1.0));
  vec3 f = p - i;
  ivec3 b = ivec3(i);
  vec3 c000 = at3(b);
  vec3 c111 = at3(b + ivec3(1, 1, 1));
  vec3 a;
  vec3 m;
  vec3 w;
  if (f.r > f.g) {
    if (f.g > f.b) { a = at3(b + ivec3(1, 0, 0)); m = at3(b + ivec3(1, 1, 0)); w = vec3(f.r, f.g, f.b); }
    else if (f.r > f.b) { a = at3(b + ivec3(1, 0, 0)); m = at3(b + ivec3(1, 0, 1)); w = vec3(f.r, f.b, f.g); }
    else { a = at3(b + ivec3(0, 0, 1)); m = at3(b + ivec3(1, 0, 1)); w = vec3(f.b, f.r, f.g); }
  } else if (f.b > f.g) { a = at3(b + ivec3(0, 0, 1)); m = at3(b + ivec3(0, 1, 1)); w = vec3(f.b, f.g, f.r); }
  else if (f.b > f.r) { a = at3(b + ivec3(0, 1, 0)); m = at3(b + ivec3(0, 1, 1)); w = vec3(f.g, f.b, f.r); }
  else { a = at3(b + ivec3(0, 1, 0)); m = at3(b + ivec3(1, 1, 0)); w = vec3(f.g, f.r, f.b); }
  return c000 + w.x * (a - c000) + w.y * (m - a) + w.z * (c111 - m);
}
void main() {
  vec4 px = texture(src, uv);
  vec3 lin = balance * toLinear(px.rgb) * gain;
  if (contrast != 1.0) lin = GREY * pow(max(lin, 0.0) / GREY, vec3(contrast));
  float y = dot(lin, LUMA);
  if (y > 1e-6) lin *= exp2(toneShift(log2(y / GREY)));
  vec3 o = toDisplay(lin);
  if (lookDim > 0) o = mix(o, look(o), clamp(lookAmount, 0.0, 1.0));
  y = dot(o, LUMA);
  float sat = clamp(max(o.r, max(o.g, o.b)) - min(o.r, min(o.g, o.b)), 0.0, 1.0);
  float k = (1.0 + saturation / 100.0) * (1.0 + vibrance / 100.0 * (1.0 - sat));
  o = clamp(vec3(y) + (o - vec3(y)) * k, 0.0, 1.0);
  // a little noise, less than one step of 8-bit colour, so smooth skies do not band
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color = vec4(o + (n - 0.5) / 255.0, px.a);
}`;

interface Look {
  dim: number;
  size: number;
  min: number[];
  max: number[];
  texture: WebGLTexture;
}

let gl: WebGL2RenderingContext | null | undefined;
let sheet: HTMLCanvasElement;
let program: WebGLProgram;
let srcTexture: WebGLTexture;
const where: Record<string, WebGLUniformLocation | null> = {};
const looks = new Map<string, Look | "loading" | "failed">();

function compile(g: WebGL2RenderingContext, kind: number, text: string) {
  const s = g.createShader(kind)!;
  g.shaderSource(s, text);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** The one WebGL2 drawing surface, made the first time a grade is needed. Null where WebGL2 is missing. */
function context(): WebGL2RenderingContext | null {
  if (gl !== undefined) return gl;
  try {
    sheet = document.createElement("canvas");
    const g = sheet.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!g) return (gl = null);
    program = g.createProgram()!;
    g.attachShader(program, compile(g, g.VERTEX_SHADER, VERTEX));
    g.attachShader(program, compile(g, g.FRAGMENT_SHADER, FRAGMENT));
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? "link");
    g.useProgram(program);
    const quad = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const at = g.getAttribLocation(program, "at");
    g.enableVertexAttribArray(at);
    g.vertexAttribPointer(at, 2, g.FLOAT, false, 0, 0);
    for (const name of ["src", "cube", "curve", "lookDim", "lookSize", "lookMin", "lookMax", "lookAmount", "balance", "gain", "contrast", "shadows", "highlights", "whites", "blacks", "saturation", "vibrance"]) {
      where[name] = g.getUniformLocation(program, name);
    }
    g.uniform1i(where.src, 0);
    g.uniform1i(where.cube, 1);
    g.uniform1i(where.curve, 2);
    srcTexture = g.createTexture()!;
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, srcTexture);
    for (const [k, v] of [
      [g.TEXTURE_MIN_FILTER, g.LINEAR],
      [g.TEXTURE_MAG_FILTER, g.LINEAR],
      [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE],
      [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE],
    ])
      g.texParameteri(g.TEXTURE_2D, k, v);
    // empty looks, so the samplers always have something bound
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_3D, g.createTexture());
    g.texImage3D(g.TEXTURE_3D, 0, g.RGB32F, 1, 1, 1, 0, g.RGB, g.FLOAT, new Float32Array(3));
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, g.createTexture());
    g.texImage2D(g.TEXTURE_2D, 0, g.RGB32F, 1, 1, 0, g.RGB, g.FLOAT, new Float32Array(3));
    return (gl = g);
  } catch (e) {
    logError("colour grade", e);
    return (gl = null);
  }
}

/** A look file, read once and kept on the graphics card. Null until it has arrived. */
function lookFor(g: WebGL2RenderingContext, path: string): Look | null {
  const have = looks.get(path);
  if (have && have !== "loading" && have !== "failed") return have;
  if (!have) {
    looks.set(path, "loading");
    invoke<{ dim: number; size: number; min: number[]; max: number[]; data: string }>("look_read", { path })
      .then((l) => {
        const bytes = Uint8Array.from(atob(l.data), (c) => c.charCodeAt(0));
        const data = new Float32Array(bytes.buffer);
        const texture = g.createTexture()!;
        if (l.dim === 3) {
          g.activeTexture(g.TEXTURE1);
          g.bindTexture(g.TEXTURE_3D, texture);
          g.texImage3D(g.TEXTURE_3D, 0, g.RGB32F, l.size, l.size, l.size, 0, g.RGB, g.FLOAT, data);
        } else {
          g.activeTexture(g.TEXTURE2);
          g.bindTexture(g.TEXTURE_2D, texture);
          g.texImage2D(g.TEXTURE_2D, 0, g.RGB32F, l.size, 1, 0, g.RGB, g.FLOAT, data);
        }
        for (const t of [g.TEXTURE_3D, g.TEXTURE_2D]) {
          g.texParameteri(t, g.TEXTURE_MIN_FILTER, g.NEAREST);
          g.texParameteri(t, g.TEXTURE_MAG_FILTER, g.NEAREST);
        }
        looks.set(path, { ...l, texture });
        window.dispatchEvent(new Event("duet:repaint"));
      })
      .catch((e) => {
        looks.set(path, "failed");
        logError("read look", e);
      });
  }
  return null;
}

/** Whether a look could not be read, so the panel can say so. */
export const lookFailed = (path: string) => looks.get(path) === "failed";

/** Run the grade on one picture, at the given size, onto the WebGL surface. False when it cannot be done. */
function run(pic: TexImageSource, w: number, h: number, g: Grade): boolean {
  const c = context();
  if (!c) return false;
  if (sheet.width !== w || sheet.height !== h) {
    sheet.width = w;
    sheet.height = h;
  }
  c.viewport(0, 0, w, h);
  c.activeTexture(c.TEXTURE0);
  c.bindTexture(c.TEXTURE_2D, srcTexture);
  c.pixelStorei(c.UNPACK_FLIP_Y_WEBGL, true);
  c.pixelStorei(c.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, c.RGBA, c.UNSIGNED_BYTE, pic);
  c.pixelStorei(c.UNPACK_FLIP_Y_WEBGL, false);
  const m = whiteBalance(g.temperature, g.tint);
  // GLSL reads a matrix column by column
  c.uniformMatrix3fv(where.balance, false, [0, 1, 2].flatMap((col) => [m[0][col], m[1][col], m[2][col]]));
  c.uniform1f(where.gain, 2 ** g.exposure);
  c.uniform1f(where.contrast, contrastPower(g.contrast));
  for (const k of ["shadows", "highlights", "whites", "blacks", "saturation", "vibrance"] as const) c.uniform1f(where[k], g[k]);
  const look = g.look && g.lookAmount > 0 ? lookFor(c, g.look) : null;
  c.uniform1i(where.lookDim, look ? look.dim : 0);
  if (look) {
    c.activeTexture(look.dim === 3 ? c.TEXTURE1 : c.TEXTURE2);
    c.bindTexture(look.dim === 3 ? c.TEXTURE_3D : c.TEXTURE_2D, look.texture);
    c.uniform1f(where.lookSize, look.size);
    c.uniform3fv(where.lookMin, look.min);
    c.uniform3fv(where.lookMax, look.max);
    c.uniform1f(where.lookAmount, g.lookAmount);
  }
  c.drawArrays(c.TRIANGLE_STRIP, 0, 4);
  return true;
}

/** Graded still pictures, kept so a picture is graded once and not on every repaint. */
const stills = new Map<string, HTMLCanvasElement>();
/** The longest side a picture is graded at on screen. The export engine always uses the full size. */
const PREVIEW_SIDE = 2048;

function fit(w: number, h: number): [number, number] {
  const k = Math.min(1, PREVIEW_SIDE / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/**
 * The picture to draw for a graded image or clip: the graded copy, or the picture itself when the grade
 * leaves it alone or cannot run. A still is kept; a clip's picture changes, so it is graded every time.
 */
export function graded(pic: HTMLImageElement | HTMLVideoElement, grade: Grade | null, still: string | null): CanvasImageSource {
  if (!grade || isNeutral(grade)) return pic;
  const nw = pic instanceof HTMLVideoElement ? pic.videoWidth : pic.naturalWidth;
  const nh = pic instanceof HTMLVideoElement ? pic.videoHeight : pic.naturalHeight;
  if (!nw || !nh) return pic;
  const lookReady = !grade.look || !(looks.get(grade.look) === undefined || looks.get(grade.look) === "loading");
  const key = still ? `${still}|${JSON.stringify(grade)}` : "";
  if (key && lookReady && stills.has(key)) return stills.get(key)!;
  const [w, h] = fit(nw, nh);
  try {
    if (!run(pic, w, h, grade)) return pic;
  } catch (e) {
    logError("colour grade", e);
    return pic;
  }
  if (!key) return sheet;
  const copy = document.createElement("canvas");
  copy.width = w;
  copy.height = h;
  copy.getContext("2d")?.drawImage(sheet, 0, 0);
  if (lookReady) {
    if (stills.size > 30) stills.clear();
    stills.set(key, copy);
  }
  return copy;
}

export interface Readings {
  /** How far the middle of the picture is from middle grey, in stops. Plus is too bright. */
  stopsFromGrey: number;
  /** Brightness, 0 to 1 in display light, below which 1, 10, 50, 90 and 99 percent of the picture sits. */
  brightness: { p1: number; p10: number; p50: number; p90: number; p99: number };
  /** Percent of the picture that is pure white, and pure black. */
  blownPercent: number;
  crushedPercent: number;
  /** Percent of the picture where each colour channel is at its top. */
  channelClipped: { r: number; g: number; b: number };
  /** The average colour cast of the mid tones. Plus warm means too orange, plus magenta means too pink. */
  cast: { warm: number; magenta: number };
  /** How colourful it is, 0 to 1, on average and at its most. */
  saturation: { mean: number; max: number };
}

/**
 * Numbers about how a graded picture looks, so an AI can check its own grade. The picture is graded
 * small (64 by 64) and read back, which takes no time at all.
 */
export function readings(pic: HTMLImageElement | HTMLVideoElement, grade: Grade | null): Readings | null {
  const c = context();
  if (!c) return null;
  const S = 64;
  const g = grade ?? { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, look: "", lookAmount: 1 };
  if (!run(pic, S, S, g)) return null;
  const px = new Uint8Array(S * S * 4);
  c.readPixels(0, 0, S, S, c.RGBA, c.UNSIGNED_BYTE, px);
  const n = S * S;
  const lum: number[] = [];
  let blown = 0;
  let crushed = 0;
  const clip = { r: 0, g: 0, b: 0 };
  let warm = 0;
  let magenta = 0;
  let mids = 0;
  let satSum = 0;
  let satMax = 0;
  let linSum = 0;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255;
    const gr = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    const y = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    lum.push(y);
    linSum += Math.log2(Math.max(1e-4, 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b)));
    if (r > 0.99 && gr > 0.99 && b > 0.99) blown++;
    if (r < 0.01 && gr < 0.01 && b < 0.01) crushed++;
    if (r > 0.99) clip.r++;
    if (gr > 0.99) clip.g++;
    if (b > 0.99) clip.b++;
    const sat = Math.max(r, gr, b) - Math.min(r, gr, b);
    satSum += sat;
    satMax = Math.max(satMax, sat);
    if (y > 0.2 && y < 0.8) {
      warm += (r - b) / 2;
      magenta += (r + b) / 2 - gr;
      mids++;
    }
  }
  lum.sort((a, b) => a - b);
  const p = (q: number) => Math.round(lum[Math.min(n - 1, Math.floor(q * n))] * 1000) / 1000;
  const pct = (k: number) => Math.round((k / n) * 1000) / 10;
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    stopsFromGrey: r2(linSum / n - Math.log2(0.18)),
    brightness: { p1: p(0.01), p10: p(0.1), p50: p(0.5), p90: p(0.9), p99: p(0.99) },
    blownPercent: pct(blown),
    crushedPercent: pct(crushed),
    channelClipped: { r: pct(clip.r), g: pct(clip.g), b: pct(clip.b) },
    cast: { warm: r2(mids ? warm / mids : 0), magenta: r2(mids ? magenta / mids : 0) },
    saturation: { mean: r2(satSum / n), max: r2(satMax) },
  };
}
