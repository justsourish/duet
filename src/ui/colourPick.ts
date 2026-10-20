/** Picking one colour from the picture: the Colour panel asks, the Before and After windows answer with a hue. */

let picking = false;
const listeners = new Set<(hue: number | null) => void>();

export const pickingColour = () => picking;

/** Start or stop waiting for a click in the picture. */
export function pickColour(on: boolean) {
  picking = on;
  if (!on) listeners.forEach((l) => l(null));
}

/** The picture was clicked: hand on the hue there, 0 to 1, and stop waiting. */
export function pickedColour(hue: number) {
  picking = false;
  listeners.forEach((l) => l(hue));
}

/** Hear the picked hue, or null when picking was stopped. Gives back a way to stop hearing. */
export function onPickedColour(l: (hue: number | null) => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
