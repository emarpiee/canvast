import type { ModelLook } from "../assets/model-look";

/** The 3D view in front (the last one opened or pressed in), for a saved line style chosen in the Styles panel. Kept apart from the view, which loads with three.js. */
export interface ModelViewFront {
  useLineStyle(style: ModelLook, name: string): void;
}
let front: ModelViewFront | null = null;
export const modelViewInFront = (): ModelViewFront | null => front;
export const setModelViewInFront = (v: ModelViewFront | null): void => void (front = v);
