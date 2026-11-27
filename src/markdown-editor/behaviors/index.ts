// The editor's behaviours: how typing, keys, clicks and pastes act, apart from how Markdown is read and drawn (syntax.ts, render.ts, live.ts).
// Each is a module of its own, named here with where it comes from, so each can be found, changed, tested or left out on its own.
import type { Extension } from "@codemirror/state";
import { autoPairs } from "./auto-pair";
import { listEnter } from "./list-enter";
import { moveLines } from "./move-lines";
import { renumberLists } from "./renumber-lists";
import { wrapSelection } from "./wrap-selection";

export { toggleInline } from "./format-toggle";
export { toggleCheckbox, toggleTask } from "./task-toggle";
export { hopMarker } from "./marker-hop";
export { reflowParagraph } from "./reflow";
export { WRAP_PAIRS, wrapTyped } from "./wrap-selection";
export { autoPair } from "./auto-pair";
export { tightListEnter } from "./list-enter";
export { linkFollow } from "./link-follow";
export { insertBlockMarkdown, pasteRules, type PasteHost } from "./paste-rules";

/** Every behaviour: its id (for `behaviors` in the editor's options), what it does and where it comes from. */
export const BEHAVIORS = [
  { id: "format-toggle", does: "A format key inside a word or a span formats it or takes it off; elsewhere an empty pair", from: "canvast's first editor; notes apps" },
  { id: "wrap-selection", does: "A pair's sign typed over selected words goes round them", from: "canvast's first editor" },
  { id: "auto-pair", does: "( [ { close themselves; quotes in code", from: "notes apps" },
  { id: "list-enter", does: "Enter adds the next list item right below", from: "notes apps" },
  { id: "renumber-lists", does: "Numbered lists keep counting as lines move", from: "notes apps" },
  { id: "move-lines", does: "Alt+Up and Alt+Down move lines", from: "notes apps" },
  { id: "marker-hop", does: "Alt+] and Alt+[ step over marks", from: "notes apps" },
  { id: "task-toggle", does: "Ctrl+L makes and ticks a task", from: "notes apps" },
  { id: "reflow", does: "Alt+Q joins a wrapped paragraph", from: "notes apps" },
  { id: "link-follow", does: "A click on a drawn link follows it", from: "notes apps" },
  { id: "paste-rules", does: "A link pasted over words makes them the link; pages become Markdown; pictures on lines of their own", from: "canvast's first editor; notes apps" },
] as const;
export type BehaviorId = (typeof BEHAVIORS)[number]["id"];

/** The behaviours that are extensions of their own (the keys' ones are in the editor's key table), each unless turned off. */
export function behaviorExtensions(on: (id: BehaviorId) => boolean, plain: boolean): Extension[] {
  return [
    on("wrap-selection") ? wrapSelection(plain) : [],
    !plain && on("auto-pair") ? autoPairs : [],
    !plain && on("list-enter") ? listEnter : [],
    !plain && on("renumber-lists") ? renumberLists : [],
    on("move-lines") ? moveLines : [],
  ];
}
