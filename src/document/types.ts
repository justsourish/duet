export type ElementType = "frame" | "rect" | "ellipse" | "text" | "image";

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface Gradient {
  from: string;
  to: string;
  /** Degrees. 0 runs left to right, 90 runs top to bottom. */
  angle: number;
}

export interface El {
  id: string;
  type: ElementType;
  name: string;
  parentId: string | null;
  /** Position relative to the parent frame, or to the page when parentId is null. */
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  opacity: number;
  text: string;
  fontSize: number;
  /** A drop shadow behind the shape, or null for none. */
  shadow: Shadow | null;
  /** A linear gradient used instead of the solid fill, or null. */
  gradient: Gradient | null;
  /** For images: where the picture file lives inside the project, like assets/3fa9c1.png. */
  src: string;
  /** In Present mode, clicking this takes you to the frame with this id. */
  link: string | null;
  childIds: string[];
}

/** Flat store: one record per element, keyed by id. Keeps Git diffs small. */
export interface Doc {
  version: 1;
  rootIds: string[];
  elements: Record<string, El>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const emptyDoc = (): Doc => ({ version: 1, rootIds: [], elements: {} });
