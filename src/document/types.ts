export type ElementType = "frame" | "rect" | "ellipse" | "text" | "image" | "path" | "group" | "instance";

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
  /** Text only. Empty means the system font. Any font installed on the computer works. */
  fontFamily: string;
  /** Text only. 400 is regular, 700 is bold. */
  fontWeight: number;
  textAlign: "left" | "center" | "right";
  /** Text only. A multiple of the font size. 0 means the default. */
  lineHeight: number;
  /** Text only. Extra space between letters, in pixels. */
  letterSpacing: number;
  /** Text only. True when the box has a set width and words wrap inside it. */
  textFixed: boolean;
  /** Text only. A saved text style this text follows, or an empty string. */
  textStyleId: string;
  /** A drop shadow behind the shape, or null for none. */
  shadow: Shadow | null;
  /** A linear gradient used instead of the solid fill, or null. */
  gradient: Gradient | null;
  /** For images: where the picture file lives inside the project, like assets/3fa9c1.png. */
  src: string;
  /** A frame or group that other things are copied from. */
  component: boolean;
  /** For an instance: the component it is a live copy of. */
  componentId: string;
  /** For an instance: what was changed on this copy, by part of the component and then property. "$root" is the copy itself. */
  overrides: Record<string, Record<string, unknown>>;
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
/** A saved look for text, shared by every text that uses it. */
export interface TextStyle {
  name: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface Doc {
  version: 1;
  /** Saved text styles, by id. */
  styles?: Record<string, TextStyle>;
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
