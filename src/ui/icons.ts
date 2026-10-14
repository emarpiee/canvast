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
import bringToFront from "lucide-static/icons/bring-to-front.svg";
import activity from "lucide-static/icons/activity.svg";
import bookmarkPlus from "lucide-static/icons/bookmark-plus.svg";
import bookmark from "lucide-static/icons/bookmark.svg";
import chevronDown from "lucide-static/icons/chevron-down.svg";
import chevronRight from "lucide-static/icons/chevron-right.svg";
import eraser from "lucide-static/icons/eraser.svg";
import x from "lucide-static/icons/x.svg";
import eye from "lucide-static/icons/eye.svg";
import eyeOff from "lucide-static/icons/eye-off.svg";
import group from "lucide-static/icons/group.svg";
import image from "lucide-static/icons/image.svg";
import layers from "lucide-static/icons/layers.svg";
import lock from "lucide-static/icons/lock.svg";
import lockKeyhole from "lucide-static/icons/lock-keyhole.svg";
import lockKeyholeOpen from "lucide-static/icons/lock-keyhole-open.svg";
import sendToBack from "lucide-static/icons/send-to-back.svg";
import ungroup from "lucide-static/icons/ungroup.svg";
import magnet from "lucide-static/icons/magnet.svg";
import waves from "lucide-static/icons/waves.svg";
import scaling from "lucide-static/icons/scaling.svg";
import pointerBan from "lucide-static/icons/mouse-pointer-ban.svg";
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
  pointerBan: clean(pointerBan),
  scaling: clean(scaling),
  waves: clean(waves),
  lock: clean(lock),
  group: clean(group),
  eraser: clean(eraser),
  activity: clean(activity),
  bookmark: clean(bookmark),
  bookmarkPlus: clean(bookmarkPlus),
  chevronDown: clean(chevronDown),
  chevronRight: clean(chevronRight),
  image: clean(image),
  layers: clean(layers),
  eye: clean(eye),
  eyeOff: clean(eyeOff),
  lockKeyhole: clean(lockKeyhole),
  lockKeyholeOpen: clean(lockKeyholeOpen),
  ungroup: clean(ungroup),
  bringToFront: clean(bringToFront),
  sendToBack: clean(sendToBack),
  magnet: clean(magnet),
} as const;
