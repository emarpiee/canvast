// Retroma's font choice (Settings › Retroma › Theme font), embedded at build time: Latin subsets in WOFF2 of fonts under the SIL Open Font
// License (Special Elite: the Apache License 2.0); their licences are in src/theme/fonts/ and travel in the built file. Installed as FontFace
// from the bytes, so nothing is fetched; once, the first time Retroma is the theme.
import atkinson400 from "./fonts/AtkinsonHyperlegible_400Regular.woff2";
import atkinson700 from "./fonts/AtkinsonHyperlegible_700Bold.woff2";
import grotesk400 from "./fonts/SpaceGrotesk_400Regular.woff2";
import grotesk700 from "./fonts/SpaceGrotesk_700Bold.woff2";
import courier400 from "./fonts/CourierPrime_400Regular.woff2";
import courier700 from "./fonts/CourierPrime_700Bold.woff2";
import fraunces500 from "./fonts/Fraunces_500Medium.woff2";
import fraunces700 from "./fonts/Fraunces_700Bold.woff2";
import specialElite from "./fonts/SpecialElite_400Regular.woff2";
import vt323 from "./fonts/VT323_400Regular.woff2";
import pressStart from "./fonts/PressStart2P_400Regular.woff2";
import caveat600 from "./fonts/Caveat_600SemiBold.woff2";
import dmMono400 from "./fonts/DMMono_400Regular.woff2";
import dmMono500 from "./fonts/DMMono_500Medium.woff2";

const FACES: ReadonlyArray<readonly [family: string, bytes: Uint8Array<ArrayBuffer>, weight: string]> = [
  ["Atkinson Hyperlegible", atkinson400, "400"], ["Atkinson Hyperlegible", atkinson700, "700"],
  ["Space Grotesk", grotesk400, "400"], ["Space Grotesk", grotesk700, "700"],
  ["Courier Prime", courier400, "400"], ["Courier Prime", courier700, "700"],
  ["Fraunces", fraunces500, "500"], ["Fraunces", fraunces700, "700"],
  ["Special Elite", specialElite, "400"], ["VT323", vt323, "400"], ["Press Start 2P", pressStart, "400"],
  ["Caveat", caveat600, "600"], ["DM Mono", dmMono400, "400"], ["DM Mono", dmMono500, "500"],
];

let installed = false;
/** Adds Retroma's fonts to the page (once). */
export function installRetromaFonts(): void {
  if (installed || typeof FontFace === "undefined") return;
  installed = true;
  for (const [family, bytes, weight] of FACES) {
    const face = new FontFace(family, bytes, { weight, display: "swap" });
    void face.load().then((f) => document.fonts.add(f), () => undefined);
  }
}
