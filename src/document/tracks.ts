import { spanOf } from "./time";
import type { Doc, El, Track } from "./types";

export type TrackKind = Track["kind"];

/** Which kind of track a thing sits on: video clips on clip tracks, sounds on sound tracks, anything else on none. */
export const trackKind = (el: El): TrackKind | null => (el.type === "video" ? "clips" : el.type === "sound" ? "sound" : null);

/** Whether two things show at the same time in the frame. */
const overlap = (a: El, b: El, frame: El) => {
  const x = spanOf(a, frame);
  const y = spanOf(b, frame);
  return x.start < y.end - 0.001 && y.start < x.end - 0.001;
};

/** Sort things into as few rows as they fit in, front first, so none in a row show at the same time. */
export function packRows(list: El[], frame: El): El[][] {
  const rows: El[][] = [];
  for (const el of list) {
    const row = rows.find((r) => !r.some((other) => overlap(el, other, frame)));
    if (row) row.push(el);
    else rows.push([el]);
  }
  return rows;
}

/** One row of clips or sounds on a frame's timeline. A row with no track is one Duet made by itself and has not saved. */
export interface TrackRow {
  kind: TrackKind;
  /** Its place among the rows of its kind, top first. */
  index: number;
  name: string;
  track: Track | null;
  items: El[];
}

const baseName = (kind: TrackKind) => (kind === "clips" ? "Clips" : "Sound");

/**
 * The rows of one kind on a frame's timeline, top first. A frame with saved tracks shows those, and a clip
 * that has none yet goes on the first one it fits on without covering another, or a new row under them.
 * A frame without saved tracks sorts its clips into rows by itself, as it always has.
 */
export function trackRows(doc: Doc, frame: El, kind: TrackKind): TrackRow[] {
  // front first, the way the timeline lists things
  const items = frame.childIds.map((id) => doc.elements[id]).filter((el): el is El => !!el && trackKind(el) === kind).reverse();
  const saved = (frame.tracks ?? []).filter((t) => t.kind === kind);
  const rows: TrackRow[] = saved.map((track, index) => ({ kind, index, name: track.name, track, items: items.filter((el) => el.track === track.id) }));
  const loose = items.filter((el) => !saved.some((t) => t.id === el.track));
  const extra: El[][] = [];
  for (const el of loose) {
    const fits = (list: El[]) => !list.some((other) => overlap(el, other, frame));
    const row = rows.find((r) => fits(r.items));
    if (row) row.items.push(el);
    else {
      const more = extra.find(fits);
      if (more) more.push(el);
      else extra.push([el]);
    }
  }
  for (const list of extra) rows.push({ kind, index: rows.length, name: `${baseName(kind)} ${rows.length + 1}`, track: null, items: list });
  return rows;
}

/** A new track id. */
let made = 0;
export const newTrackId = () => `track-${Date.now().toString(36)}${(made++).toString(36)}`;

/**
 * Save the rows a frame shows as its own tracks, so they stay put from now on. It changes nothing that can be
 * seen: every clip stays on the row it was on. Works on a copy of the document that is being changed.
 */
export function keepTracks(doc: Doc, frameId: string): Track[] {
  const frame = doc.elements[frameId];
  const tracks: Track[] = [];
  for (const kind of ["clips", "sound"] as const) {
    for (const row of trackRows(doc, frame, kind)) {
      const track = row.track ?? { id: newTrackId(), name: row.name, kind };
      tracks.push(track);
      for (const el of row.items) doc.elements[el.id].track = track.id;
    }
  }
  frame.tracks = tracks;
  return tracks;
}

/** The tracks of one kind, top first. */
export const tracksOf = (frame: El, kind: TrackKind) => (frame.tracks ?? []).filter((t) => t.kind === kind);

/** Put the clips in front of or behind each other the way their tracks are: a higher track is in front. Only clips trade places. */
export function stackByTrack(doc: Doc, frameId: string) {
  const frame = doc.elements[frameId];
  const order = tracksOf(frame, "clips").map((t) => t.id);
  const slots: number[] = [];
  const clips: string[] = [];
  frame.childIds.forEach((id, i) => {
    if (doc.elements[id]?.type === "video") {
      slots.push(i);
      clips.push(id);
    }
  });
  const depth = (id: string) => {
    const i = order.indexOf(doc.elements[id].track ?? "");
    return i < 0 ? order.length : i;
  };
  // the list goes back to front, so the lowest track comes first; clips on one track keep their order
  const sorted = clips.map((id, i) => ({ id, i })).sort((a, b) => depth(b.id) - depth(a.id) || a.i - b.i);
  slots.forEach((slot, n) => (frame.childIds[slot] = sorted[n].id));
}
