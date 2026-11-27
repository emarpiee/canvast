// Inter Regular (SIL Open Font License 1.1, see THIRD_PARTY_NOTICES.md), embedded at build time.
import bytes from "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf";
// (the interface's names and titles: medium and semibold, so they are not drawn as a thickened regular)
import medium from "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf";
import semibold from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf";
import { parseFont } from "./font";
import { setFallbackMeasure, setFont } from "./layout";
import { BUNDLED_FAMILY, FALLBACK_FAMILY } from "./fonts";

/**
 * Install the bundled font for layout and drawing. The browser gets it as a
 * FontFace built from the embedded bytes (no fetch, so the page's
 * Content-Security-Policy needs no font source); `onReady` runs once it can
 * draw with it, to redraw text drawn with the interim fallback.
 */
export function installTextFont(onReady: () => void): void {
  setFont(parseFont(bytes));
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `100px ${FALLBACK_FAMILY}`;
  const widths = new Map<number, number>();
  setFallbackMeasure((cp) => {
    let w = widths.get(cp);
    if (w === undefined) widths.set(cp, (w = m.measureText(String.fromCodePoint(cp)).width / 100));
    return w;
  });
  const face = new FontFace(BUNDLED_FAMILY, bytes);
  document.fonts.add(face);
  // (by its own name too: the notes editor's font list, and the interface's font, --font-ui, in its three weights)
  for (const [b, weight] of [[bytes, "400"], [medium, "500"], [semibold, "600"]] as const) void new FontFace("Inter", b, { weight }).load().then((g) => document.fonts.add(g), () => undefined);
  face.load().then(onReady, () => undefined);
}
