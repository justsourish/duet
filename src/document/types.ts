export type ElementType = "frame" | "rect" | "ellipse" | "text" | "image" | "path" | "group";

/** One point on a drawn line. All numbers are fractions of the element's box, so resizing just works. */
export interface PathNode {
  x: number;
  y: number;
  /** How far the handle on the way in reaches, from this point. 0 and 0 means none. */
  ix: number;
  iy: number;
  /** How far the handle on the way out reaches, from this point. */
  ox: number;
  oy: number;
}

/** Lines up a frame's children in a row or a column. */
export interface Layout {
  dir: "row" | "column";
  gap: number;
  padX: number;
  padY: number;
  /** Across the direction: start, centre, end, or stretch to fill the frame. */
  align: "start" | "center" | "end" | "stretch";
  /** Along the direction: where the children sit, or spread out with equal space between. */
  justify: "start" | "center" | "end" | "between";
  /** Shrink the frame to fit what is inside it. */
  hug: boolean;
}

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
  /** Locked things cannot be picked on the canvas, so you can select what is behind or inside them. */
  locked: boolean;
  /** For frames: auto layout, or null to place children by hand. */
  layout: Layout | null;
  /** Inside an auto layout frame: 1 to grow and fill the free space along the direction, 0 to keep its size. */
  grow: number;
  /** For drawn lines: the points, and whether the line joins back to its start. */
  nodes: PathNode[];
  closed: boolean;
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
