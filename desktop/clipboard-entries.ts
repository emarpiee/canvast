/**
 * What goes on the system's clipboard for a copy, under the names each system uses. Pure, so that every system's answer can be tested on any of them.
 * Files and pictures use Electron's own names: it maps `text/uri-list` to each system's "copied files" (CF_HDROP on Windows, NSFilenamesPboardType on
 * macOS, text/uri-list on Linux). An SVG has no such name, so it goes as the system's own format; a program that does not know it takes the file or the PNG.
 */
const raw = (format: string): string => `electron application/osclipboard;format="${format}"`;

const SVG_FORMAT: Readonly<Partial<Record<NodeJS.Platform, string>>> = { darwin: "public.svg-image" };

/** A mark among the formats of a copy: what says later that the clipboard still holds that copy, and nothing has been copied since. */
export const COPY_MARK = "web application/x.canvast-copy";

export interface ClipboardAlso {
  readonly svg?: unknown;
  readonly png?: unknown;
  readonly text?: unknown;
  readonly mark?: unknown;
}

export function clipboardEntries(urls: readonly string[], { svg, png, text, mark }: ClipboardAlso, platform: NodeJS.Platform): Record<string, string | Blob> {
  return {
    ...(urls.length ? { "text/uri-list": urls.join("\r\n") } : {}),
    // (file managers of GNOME read their own list, a word and then the addresses)
    ...(urls.length && platform === "linux" ? { [raw("x-special/gnome-copied-files")]: `copy\n${urls.join("\n")}` } : {}),
    ...(typeof svg === "string" ? { [raw(SVG_FORMAT[platform] ?? "image/svg+xml")]: svg } : {}),
    ...(png instanceof Uint8Array ? { "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) } : {}),
    ...(typeof text === "string" ? { "text/plain": text } : {}),
    ...(typeof mark === "string" ? { [COPY_MARK]: mark } : {}),
  };
}
