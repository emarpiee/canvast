import type { CanvasActions } from "../app/canvas-commands";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";

/**
 * Which view of a canvas is in use (the main view, or a pinned one in Pins that was pressed last), ADR 0208: every command, key and menu
 * row runs on it, through its own actions made by the one function that makes them (no copy for another view). The parts of the interface
 * that follow the view in use (the Actions bar, the Adjust panel) read and change it through `editorInUse` and `docInUse`, and hear every
 * view's changes.
 */
interface View { id: string; actions: CanvasActions | null; editor: EditorState; doc: DocumentStore; offs: Array<() => void> }
let views: View[] = [];
let focused = "main";
const heard = { editor: new Set<() => void>(), redraw: new Set<() => void>(), doc: new Set<(...a: unknown[]) => void>() };
const tell = (): void => heard.editor.forEach((f) => f());

/** A view of a canvas: its actions (null until they are made: the main view's come later in its start than its editor), its editor and document. */
export function addCanvasView(id: string, actions: CanvasActions | null, editor: EditorState, doc: DocumentStore): () => void {
  views.find((v) => v.id === id)?.offs.forEach((f) => f());
  const offs = [editor.subscribe(() => heard.editor.forEach((f) => f())), editor.subscribeRedraw(() => heard.redraw.forEach((f) => f())), doc.subscribe((...a: unknown[]) => heard.doc.forEach((f) => f(...a)))];
  views = [...views.filter((v) => v.id !== id), { id, actions, editor, doc, offs }];
  return () => {
    offs.forEach((f) => f());
    views = views.filter((v) => v.id !== id);
    if (focused === id) (focused = "main"), tell();
  };
}
/** A view's actions, made after it was added (the main view's). */
export const setViewActions = (id: string, actions: CanvasActions): void => {
  const v = views.find((x) => x.id === id);
  if (v) v.actions = actions;
};
/** The view in use now: a press or the focus in it. */
export const focusCanvasView = (id: string): void => {
  const next = views.some((v) => v.id === id) ? id : "main";
  if (next === focused) return;
  focused = next;
  tell(); // (what follows the view in use shows it)
};
export const focusedCanvasView = (): string => focused;
const inUse = (): View => views.find((v) => v.id === focused) ?? views.find((v) => v.id === "main")!;
const mainView = (): View => views.find((v) => v.id === "main")!;

/** The actions of the view in use, as one object (the registry's commands read it at each call). */
export function routedActions(): CanvasActions {
  return new Proxy({} as CanvasActions, { get: (_t, k) => (inUse().actions ?? mainView().actions)?.[k as keyof CanvasActions] });
}

/** Whether the app's panels are open is the app's, not a view's: it stays with the main view's editor. */
const APP_FLAGS = new Set(["adjustOpen", "layersOpen", "bookmarksOpen", "tagsOpen", "stylesOpen", "stylesTab", "patternOpen"]);
/** One object standing for the view in use's `T`: it reads and writes that one; `subscribe` hears every view (and a change of view). */
function forward<T extends object>(of: (v: View) => T, subs: Record<string, Set<(...a: never[]) => void>>): T {
  return new Proxy({} as T, {
    get: (_t, k) => {
      const set = typeof k === "string" ? subs[k] : undefined;
      if (set) return (fn: (...a: never[]) => void) => (set.add(fn), () => void set.delete(fn));
      const target = (typeof k === "string" && APP_FLAGS.has(k) ? of(mainView()) : of(inUse())) as Record<string | symbol, unknown>;
      const v = target[k];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (_t, k, value) => {
      const target = (typeof k === "string" && APP_FLAGS.has(k) ? of(mainView()) : of(inUse())) as Record<string | symbol, unknown>;
      target[k] = value;
      return true;
    },
  });
}
/** The editor of the view in use (its selection, its tool's state); its panels' flags are the main view's. */
export const editorInUse: EditorState = forward((v) => v.editor, { subscribe: heard.editor, subscribeRedraw: heard.redraw });
/** The document of the view in use. */
export const docInUse: DocumentStore = forward((v) => v.doc, { subscribe: heard.doc as Set<(...a: never[]) => void> });

/** The Actions bar's actions of each view (ui/context-bar.ts), by view. */
const barActions = new Map<string, object>();
export const setBarActions = (id: string, actions: object): void => void barActions.set(id, actions);
export const dropBarActions = (id: string): void => void barActions.delete(id);
/** The Actions bar's actions of the view in use, as one object. */
export function routedBarActions<T extends object>(): T {
  return new Proxy({} as T, { get: (_t, k) => (barActions.get(focused) ?? barActions.get("main"))![k as never] });
}
