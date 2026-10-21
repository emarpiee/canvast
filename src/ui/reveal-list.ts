/**
 * A long press with a finger lists what is under it (ADR 0151): a row outlines its thing while touched and picks it when tapped; "Add to the
 * pick" keeps what is picked. Shared by the canvas and the Painting view's vector layers (ADR 0167).
 */
import type { ScreenPoint } from "../core/camera";
import type { EditorState } from "../app/editor-state";
import type { CanvasObject, ObjectId } from "../doc/model";
import { ICONS } from "./icons";
import { labelOf } from "./layers-panel";
import { closeMoreMenu, openMoreMenu, type MenuItem } from "./more-menu";

export function openRevealList(el: HTMLElement, editor: EditorState, at: ScreenPoint, things: readonly CanvasObject[], pick: (id: ObjectId, additive: boolean) => void, names?: ReadonlyMap<string, string>): void {
  const box = el.getBoundingClientRect();
  const anchor = document.createElement("div");
  anchor.style.cssText = `position:fixed;left:${box.left + at.x}px;top:${box.top + at.y}px;width:0;height:0;pointer-events:none`;
  document.body.appendChild(anchor);
  let add = false;
  const items = (): MenuItem[] => [
    { id: "reveal-add", label: "Add to the pick", hint: "Tap to add or take out; tap outside when done", icon: ICONS.listChecks, checked: add, run: () => { add = !add; } },
    ...things.map((o): MenuItem => {
      const l = labelOf(o, names);
      // ticked while picked; in "Add to the pick" a tap on a picked one takes it out again
      return { id: o.id, label: l.text, icon: l.icon, checked: editor.selection.has(o.id), run: () => {
        if (add && editor.selection.has(o.id)) editor.select([...editor.selection].filter((x) => x !== o.id));
        else pick(o.id, add);
        if (!add) closeMoreMenu();
      } };
    }),
  ];
  openMoreMenu(anchor, items(), "Under your finger", {
    keepOpen: true,
    consumeOutside: true,
    needPress: true,
    refresh: items,
    onActive: (i) => { const o = i === null || i < 1 ? undefined : things[i - 1]; editor.revealIds = o ? new Set([o.id]) : null; editor.redraw(); },
    onClose: () => { anchor.remove(); editor.revealIds = null; editor.redraw(); },
  });
}
