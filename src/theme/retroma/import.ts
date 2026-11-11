// Presets from Style Manager's retroma-presets.json (the owner's Retroma for Obsidian): each preset's Retroma keys in these settings.
// The demo's mapping kept as it is (its key names are Retroma's own); typed at its one function.
// @ts-nocheck
import { BASE, FONTS, clone, hexToOklch } from "./engine";
const OL_STYLES = ["solid", "dashed", "dotted", "double"];
// Style Manager's retroma-presets.json: each preset's Retroma keys, in these settings
const RTM_FONTS = { "rtm-font-atkinson-hyperlegible": FONTS[0][0], "rtm-font-space-grotesk": FONTS[2][0], "rtm-font-courier-prime": FONTS[3][0], "rtm-font-fraunces": FONTS[4][0], "rtm-font-special-elite": FONTS[5][0], "rtm-font-vt323": FONTS[6][0], "rtm-font-press-start-2p": FONTS[7][0], "rtm-font-caveat": FONTS[8][0], "rtm-font-cascadia-code": FONTS[9][0], "rtm-font-ia-writer-mono-s": FONTS[9][0] };
const RTM_SCHEMES = { default: "330,30", "rtm-cs-analogous-colors": "330,30", "rtm-cs-analogous-colors-flipped": "30,330", "rtm-cs-split-complementary-colors": "150,210", "rtm-cs-split-complementary-colors-flipped": "210,150", "rtm-cs-triadic-colors": "120,240", "rtm-cs-triadic-colors-flipped": "240,120", "rtm-cs-monochromatic-colors": "5,355", "rtm-cs-monochromatic-colors-flipped": "355,5" };
const RTM_NUM = { "rtm-chroma-lightmode-accent": "cf", "rtm-chroma-darkmode-accent": "cfDark", "rtm-l-accent": "lDark", "rtm-interface-radius": "r", "rtm-btn-radius": "br", "rtm-tab-radius": "tabR", "rtm-img-radius": "imgR", "rtm-callout-radius": "coR", "rtm-code-radius": "codeR", "rtm-tag-radius": "tagR", "rtm-checkbox-radius": "checkR", "rtm-blockquote-radius": "bqR", "rtm-code-border-width": "codeOl", "rtm-nav-folder-radius": "folderR", "rtm-nav-file-radius": "fileR", "rtm-nav-folder-border-width": "folderOl", "rtm-metadata-radius": "propsR", "rtm-metadata-property-radius": "propR", "rtm-workspace-primary-border-width": "fwo", "rtm-workspace-secondary-border-width": "fwi", "rtm-lightness-lightmode-txt-normal": "txtLLt", "rtm-lightness-darkmode-txt-normal": "txtLDk", "rtm-chroma-lightmode-txt": "txtCLt", "rtm-chroma-darkmode-txt": "txtCDk", "rtm-crt-overlay-scanline-width": "scan" };
const RTM_3D = { "shadow-thickness": "sT", "light-thickness": "hT", "shadow-blur": "sB", "light-blur": "hB", "shadow-lightness": "sL", "light-lightness": "hL", "shadow-opacity": "sO", "light-opacity": "hO", "shadow-color": "sC", "light-color": "hC" };
const RTM_RING = { groove: "groove", ridge: "ridge", inset: "bevel-in", outset: "bevel-out", solid: "flat" };
export function importRetromaPresets(list: unknown): Array<{ name: string; hex: string; over: Record<string, unknown> }> {
  const found = [];
  for (const p of Array.isArray(list) ? list : [list]) {
    if (!p || !p.data) continue;
    const d = Object.fromEntries(Object.entries(p.data).map(([k, v]) => [k.split("@@").pop(), v]));
    const o = {}, num = (v) => parseFloat(String(v));
    if (/\(dark\)/i.test(p.name || "")) o.mode = "dark";
    for (const [k, v] of Object.entries(d)) {
      if (RTM_NUM[k] && Number.isFinite(num(v))) o[RTM_NUM[k]] = num(v);
      else if (k === "workspace-color-scheme" && RTM_SCHEMES[v]) o.scheme = RTM_SCHEMES[v];
      else if (k === "workspace-font-selection" && RTM_FONTS[v]) o.font = RTM_FONTS[v];
      else if (k === "nav-btn-style-selection") o.btn = /neubrutal/.test(v) ? "neu" : "skeuo";
      else if (k === "rtm-workspace-primary-border-style" && RTM_RING[v]) o.ring = RTM_RING[v];
      else if (k === "rtm-workspace-secondary-border-style" && OL_STYLES.includes(v)) o.ringIStyle = v;
      else if (k === "rtm-ss-crt-overlay") o.crt = !!v;
      else if (k === "rtm-ss-grayscale-bg") o.greyBg = !!v;
      else if (k === "rtm-ss-grayscale-folder") o.greyFiles = !!v;
      else if (k === "rtm-3d-light-angle") { o.lt = { ...(o.lt || clone(BASE.lt)), angle: num(v) }; o.dk = { ...(o.dk || clone(BASE.dk)), angle: num(v) }; }
      else if (k === "rtm-lightness-lightmode-btn") { o.lt = { ...(o.lt || clone(BASE.lt)), iconL: num(v) }; }
      else if (k === "rtm-lightness-darkmode-btn") { o.dk = { ...(o.dk || clone(BASE.dk)), iconL: num(v) }; }
      else {
        const m = /^rtm-btn-(darkmode-)?3d-(.+?)(-active)?$/.exec(k);
        if (m && RTM_3D[m[2]]) { const mode = m[1] ? "dk" : "lt", st = m[3] ? "a" : "n"; o[mode] = o[mode] || clone(BASE[mode]); o[mode][st][RTM_3D[m[2]]] = RTM_3D[m[2]].endsWith("C") ? String(v) : num(v); }
      }
    }
    if (d["rtm-primary-accent-rotation"] !== undefined && !d["workspace-color-scheme"]) { o.scheme = "custom"; o.rot1 = num(d["rtm-primary-accent-rotation"]); o.rot2 = num(d["rtm-secondary-accent-rotation"] ?? 30); }
    const hex = /^#[0-9a-f]{6}$/i.test(d.__style_manager_accent_color || "") ? d.__style_manager_accent_color : "#8a5cf5";
    const ok = hexToOklch(hex);
    found.push({ name: (p.name || "Imported").replace(/^Retroma:\s*/, "Imported: "), hex, over: { ...o, hue: Math.round(ok.h), chroma: +ok.C.toFixed(3), accentL: +ok.L.toFixed(2), hex } });
  }
  return found;
}
