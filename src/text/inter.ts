// Inter Regular (SIL Open Font License 1.1, see THIRD_PARTY_NOTICES.md), embedded at build time.
import bytes from "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf";
import { parseFont } from "./font";
import { setFallbackMeasure, setFont } from "./layout";
import { FALLBACK_FONT_FAMILY, TEXT_FONT_FAMILY } from "../render/draw-text";

/**
 * Install the bundled font for layout and drawing. The browser gets it as a
 * FontFace built from the embedded bytes (no fetch, so the page's
 * Content-Security-Policy needs no font source); `onReady` runs once it can
 * draw with it, to redraw text drawn with the interim fallback.
 */
export function installTextFont(onReady: () => void): void {
  setFont(parseFont(bytes));
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `100px ${FALLBACK_FONT_FAMILY}`;
  const widths = new Map<number, number>();
  setFallbackMeasure((cp) => {
    let w = widths.get(cp);
    if (w === undefined) widths.set(cp, (w = m.measureText(String.fromCodePoint(cp)).width / 100));
    return w;
  });
  const face = new FontFace(TEXT_FONT_FAMILY, bytes);
  document.fonts.add(face);
  face.load().then(onReady, () => undefined);
}
