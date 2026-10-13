// Lucide icons (ISC license, see THIRD_PARTY_NOTICES.md), inlined at build time.
import hand from "lucide-static/icons/hand.svg";
import pointer from "lucide-static/icons/mouse-pointer-2.svg";
import pencil from "lucide-static/icons/pencil.svg";
import lasso from "lucide-static/icons/lasso.svg";
import imagePlus from "lucide-static/icons/image-plus.svg";
import undo from "lucide-static/icons/undo-2.svg";
import redo from "lucide-static/icons/redo-2.svg";
import trash from "lucide-static/icons/trash-2.svg";
import house from "lucide-static/icons/house.svg";
import plus from "lucide-static/icons/plus.svg";
import minus from "lucide-static/icons/minus.svg";

function clean(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/width="24" height="24"/, 'width="18" height="18" aria-hidden="true" focusable="false"')
    .trim();
}

export const ICONS = {
  hand: clean(hand),
  pointer: clean(pointer),
  pencil: clean(pencil),
  lasso: clean(lasso),
  imagePlus: clean(imagePlus),
  undo: clean(undo),
  redo: clean(redo),
  trash: clean(trash),
  house: clean(house),
  plus: clean(plus),
  minus: clean(minus),
} as const;
