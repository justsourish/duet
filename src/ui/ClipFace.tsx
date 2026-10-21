import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { fileTimeAt } from "../document/time";
import type { El } from "../document/types";
import { PEAK_SLICE, frameAt, peaksOf, stripOf } from "../video/faces";
import type { Strip } from "../video/faces";

/** Wider than this is stretched, so a very long bar stays a size a canvas can be. */
const MOST_WIDE = 6000;
/** How tall the sound of a video is drawn, along the bottom of its frames. */
const VIDEO_WAVE = 12;

/**
 * What is in a clip, drawn along its bar: small frames of the picture for a video, with how loud it is
 * along their bottom, and only how loud it is for a sound. `from` is the moment the bar starts. It follows the clip's speed and where it was cut from.
 */
export default function ClipFace({ el, from, pps, width, height, on }: { el: El; from: number; pps: number; width: number; height: number; on: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strip, setStrip] = useState<Strip | null>(null);
  const [frames, setFrames] = useState<HTMLImageElement | null>(null);
  const [loud, setLoud] = useState<Uint8Array | null>(null);
  const video = el.type === "video";

  useEffect(() => {
    let live = true;
    if (video) {
      void stripOf(el.src).then((s) => {
        if (!live || !s) return;
        const img = new Image();
        img.onload = () => {
          if (!live) return;
          setStrip(s);
          setFrames(img);
        };
        img.src = convertFileSrc(s.path);
      });
    }
    void peaksOf(el.src).then((p) => live && setLoud(p));
    return () => {
      live = false;
    };
  }, [el.src, video]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const w = Math.max(1, Math.min(MOST_WIDE, Math.round(width)));
    c.width = w;
    c.height = height;
    g.clearRect(0, 0, w, height);
    const per = width / w;
    if (video && strip && frames) {
      // frames side by side at the picture's shape; each shows the second of the file under its middle
      const tile = Math.max(8, (strip.width * height) / strip.height / per);
      for (let x = 0; x < w; x += tile) {
        const t = fileTimeAt(el, from, from + ((x + tile / 2) * per) / pps);
        g.drawImage(frames, frameAt(strip, t) * strip.width, 0, strip.width, strip.height, x, 0, tile, height);
      }
    }
    if (loud && loud.length) {
      // a video's sound sits in a dark band along the bottom of its frames, rising from the bottom edge
      const band = video ? VIDEO_WAVE : height - 6;
      if (video) {
        g.fillStyle = "rgba(0, 0, 0, 0.55)";
        g.fillRect(0, height - VIDEO_WAVE, w, VIDEO_WAVE);
        g.fillStyle = "rgba(255, 255, 255, 0.85)";
      } else g.fillStyle = getComputedStyle(c).color;
      const mid = height / 2;
      for (let x = 0; x < w; x++) {
        // the loudest slice among those this column covers
        const a = Math.floor(fileTimeAt(el, from, from + (x * per) / pps) / PEAK_SLICE);
        const b = Math.max(a + 1, Math.floor(fileTimeAt(el, from, from + ((x + 1) * per) / pps) / PEAK_SLICE));
        let top = 0;
        for (let i = Math.max(0, Math.min(a, b)); i < Math.min(loud.length, Math.max(a, b)); i++) top = Math.max(top, loud[i]);
        const h = Math.max(1, (top / 255) * band);
        if (video) g.fillRect(x, height - h, 1, h);
        else g.fillRect(x, mid - h / 2, 1, h);
      }
    }
  }, [video, strip, frames, loud, el, from, pps, width, height, on]);

  return <canvas ref={canvas} className={`clip-face ${video ? "frames" : "wave"}`} style={{ width, height }} aria-hidden />;
}
