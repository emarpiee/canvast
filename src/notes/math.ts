// Math in notes, drawn by KaTeX (bundled: the app goes nowhere). Its fonts are registered from the bytes in the file (the page's policy
// loads no font from an address), the first time a note draws math; its stylesheet, without their @font-face, is in the build (build.mjs).
import katex from "katex";
import f0 from "katex/dist/fonts/KaTeX_AMS-Regular.woff2";
import f1 from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2";
import f2 from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2";
import f3 from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2";
import f4 from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2";
import f5 from "katex/dist/fonts/KaTeX_Main-Bold.woff2";
import f6 from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2";
import f7 from "katex/dist/fonts/KaTeX_Main-Italic.woff2";
import f8 from "katex/dist/fonts/KaTeX_Main-Regular.woff2";
import f9 from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2";
import f10 from "katex/dist/fonts/KaTeX_Math-Italic.woff2";
import f11 from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2";
import f12 from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2";
import f13 from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2";
import f14 from "katex/dist/fonts/KaTeX_Script-Regular.woff2";
import f15 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2";
import f16 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2";
import f17 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2";
import f18 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2";
import f19 from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2";

const FONTS: ReadonlyArray<readonly [string, Uint8Array, string, string]> = [
  ["KaTeX_AMS", f0, "normal", "400"],
  ["KaTeX_Caligraphic", f1, "normal", "700"],
  ["KaTeX_Caligraphic", f2, "normal", "400"],
  ["KaTeX_Fraktur", f3, "normal", "700"],
  ["KaTeX_Fraktur", f4, "normal", "400"],
  ["KaTeX_Main", f5, "normal", "700"],
  ["KaTeX_Main", f6, "italic", "700"],
  ["KaTeX_Main", f7, "italic", "400"],
  ["KaTeX_Main", f8, "normal", "400"],
  ["KaTeX_Math", f9, "italic", "700"],
  ["KaTeX_Math", f10, "italic", "400"],
  ["KaTeX_SansSerif", f11, "normal", "700"],
  ["KaTeX_SansSerif", f12, "italic", "400"],
  ["KaTeX_SansSerif", f13, "normal", "400"],
  ["KaTeX_Script", f14, "normal", "400"],
  ["KaTeX_Size1", f15, "normal", "400"],
  ["KaTeX_Size2", f16, "normal", "400"],
  ["KaTeX_Size3", f17, "normal", "400"],
  ["KaTeX_Size4", f18, "normal", "400"],
  ["KaTeX_Typewriter", f19, "normal", "400"],
];

let fontsAdded = false;
function addFonts(): void {
  if (fontsAdded) return;
  fontsAdded = true;
  for (const [family, bytes, style, weight] of FONTS) {
    const face = new FontFace(family, bytes as unknown as ArrayBuffer, { style, weight, display: "block" });
    document.fonts.add(face);
    void face.load().catch(() => undefined);
  }
}

/** TeX as HTML (`display`: a block of its own). Throws on TeX that does not parse, with KaTeX's message. */
export function renderMath(tex: string, display: boolean): string {
  addFonts();
  return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "html", strict: "ignore", trust: false });
}
