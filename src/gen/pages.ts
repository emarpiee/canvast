import { Ch, R, steady, when } from "./kit";
import type { Section, Values } from "./types";

/**
 * Page sizes for what is laid out on a page (a storyboard, a comic page): each as width × height standing up (portrait), in millimetres or,
 * for a screen or a webtoon strip, pixels; only their shape is used. One list for the guides and the comic page (doc/comic.ts).
 */
export const PAGE_SIZES: ReadonlyArray<readonly [id: string, label: string, w: number, h: number]> = [
  ["a4", "A4", 210, 297],
  ["a5", "A5", 148, 210],
  ["a3", "A3", 297, 420],
  ["letter", "Letter", 216, 279],
  ["tabloid", "Tabloid", 279, 432],
  ["us-comic", "US comic book", 168, 260],
  ["manga", "Manga (B5)", 182, 257],
  ["album", "Comic album", 240, 320],
  ["webtoon", "Webtoon panel", 800, 1280],
  ["screen", "Screen 16:9", 1080, 1920],
  ["classic", "Screen 4:3", 3, 4],
  ["square", "Square", 1, 1],
];
const PRESETS = PAGE_SIZES.map(([id]) => id);

/** The width ÷ height of a page: a preset turned as `orient` says, or `w` × `h` (any units) for "custom"; null for "sheet" (the sheet as it is). */
export function pageRatio(page: string, orient: string, w = 1, h = 1): number | null {
  if (page === "custom") return w > 0 && h > 0 ? w / h : null;
  const p = PAGE_SIZES.find(([id]) => id === page);
  if (!p) return null;
  return orient === "landscape" ? p[3] / p[2] : p[2] / p[3];
}

/** The Page section of a guide laid out on a page: its size and way up, or the sheet as it is (the default: nothing is resized). */
export const pageSection = (orient: "portrait" | "landscape"): Section => ({
  title: "Page",
  items: [
    steady(Ch("page", "Page size", [["sheet", "The sheet as it is"], ...PAGE_SIZES.map(([id, label]): [string, string] => [id, label]), ["custom", "Custom"]], "sheet", true)),
    steady(when("page", PRESETS, Ch("orient", "Orientation", [["portrait", "Portrait"], ["landscape", "Landscape"]], orient))),
    steady(when("page", ["custom"], R("pageW", "Page width", 1, 2000, orient === "landscape" ? 297 : 210))),
    steady(when("page", ["custom"], R("pageH", "Page height", 1, 2000, orient === "landscape" ? 210 : 297))),
  ],
});

/** The shape a guide's settings give its sheet (width ÷ height), or null when it draws on the sheet as it is. */
export const pageRatioOf = (v: Values): number | null => (typeof v["page"] === "string" ? pageRatio(v["page"], String(v["orient"] ?? "portrait"), Number(v["pageW"] ?? 1), Number(v["pageH"] ?? 1)) : null);
