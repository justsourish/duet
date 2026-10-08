export type ElementType = "frame" | "rect" | "ellipse" | "text";

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
