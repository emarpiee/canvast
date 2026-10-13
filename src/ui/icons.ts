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
import infinity from "lucide-static/icons/infinity.svg";
import images from "lucide-static/icons/images.svg";
import locate from "lucide-static/icons/locate.svg";
import mapPin from "lucide-static/icons/map-pin.svg";
import upload from "lucide-static/icons/upload.svg";
import x from "lucide-static/icons/x.svg";
import type from "lucide-static/icons/type.svg";
import bold from "lucide-static/icons/bold.svg";
import italic from "lucide-static/icons/italic.svg";
import heading1 from "lucide-static/icons/heading-1.svg";
import heading2 from "lucide-static/icons/heading-2.svg";
import heading3 from "lucide-static/icons/heading-3.svg";
import pilcrow from "lucide-static/icons/pilcrow.svg";
import list from "lucide-static/icons/list.svg";
import listOrdered from "lucide-static/icons/list-ordered.svg";
import copy from "lucide-static/icons/copy.svg";
import check from "lucide-static/icons/check.svg";

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
  infinity: clean(infinity),
  images: clean(images),
  locate: clean(locate),
  mapPin: clean(mapPin),
  upload: clean(upload),
  x: clean(x),
  type: clean(type),
  bold: clean(bold),
  italic: clean(italic),
  heading1: clean(heading1),
  heading2: clean(heading2),
  heading3: clean(heading3),
  pilcrow: clean(pilcrow),
  list: clean(list),
  listOrdered: clean(listOrdered),
  copy: clean(copy),
  check: clean(check),
} as const;
