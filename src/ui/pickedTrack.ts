import { useSyncExternalStore } from "react";
import type { TrackRef } from "../commands";

/** The track picked by its name on the timeline: what is pasted into its frame goes on it, at the playhead. */
export interface PickedTrack extends TrackRef {
  frameId: string;
}

let picked: PickedTrack | null = null;
const watchers = new Set<() => void>();

export const getPickedTrack = () => picked;

export function pickTrack(next: PickedTrack | null) {
  picked = next;
  watchers.forEach((w) => w());
}

const watch = (w: () => void) => {
  watchers.add(w);
  return () => void watchers.delete(w);
};

export const usePickedTrack = () => useSyncExternalStore(watch, getPickedTrack);
