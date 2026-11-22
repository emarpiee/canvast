import type { CanvasActions } from "../app/canvas-commands";

/**
 * Which view of a canvas the canvas's commands act on (the main view, or a pinned one in Pins that has the focus): every command, key and menu
 * row runs on the view in use, through its own actions made by the one function that makes them (no copy for another view).
 */
let views: { id: string; actions: CanvasActions }[] = [];
let focused = "main";

export function addCanvasView(id: string, actions: CanvasActions): () => void {
  views = [...views.filter((v) => v.id !== id), { id, actions }];
  return () => {
    views = views.filter((v) => v.id !== id);
    if (focused === id) focused = "main";
  };
}
/** The view in use now: a press or the focus in it. */
export const focusCanvasView = (id: string): void => void (focused = views.some((v) => v.id === id) ? id : "main");
export const focusedCanvasView = (): string => focused;

/** The actions of the view in use, as one object (the registry's commands read it at each call). */
export function routedActions(): CanvasActions {
  const now = (): CanvasActions => (views.find((v) => v.id === focused) ?? views.find((v) => v.id === "main")!).actions;
  return new Proxy({} as CanvasActions, { get: (_t, k) => now()[k as keyof CanvasActions] });
}
