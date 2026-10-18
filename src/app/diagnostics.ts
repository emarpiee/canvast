/**
 * Diagnostics (ADR 0135): what went wrong this session (errors and rejected promises, kept to the last 100), what this browser can do,
 * and a report a person can save and send. Nothing is sent anywhere by the app; the report is a file the person makes.
 */
export interface LoggedError {
  readonly at: number;
  readonly what: string;
}

const log: LoggedError[] = [];
const MAX = 100;
const listeners = new Set<() => void>();

const add = (what: string): void => {
  log.push({ at: Date.now(), what: what.slice(0, 600) });
  if (log.length > MAX) log.shift();
  for (const fn of listeners) fn();
};

/** Start keeping the errors of the page. */
export function startErrorLog(): void {
  window.addEventListener("error", (e) => add(`${e.message || "Error"}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`));
  window.addEventListener("unhandledrejection", (e) => add(`Unhandled rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
}

export const errorLog = (): readonly LoggedError[] => log;
export const clearErrorLog = (): void => {
  log.length = 0;
  for (const fn of listeners) fn();
};
export const onErrorLog = (fn: () => void): void => void listeners.add(fn);

/** What this browser has that canvast uses. */
export function capabilities(): Array<{ name: string; ok: boolean; note: string }> {
  const w = window as unknown as Record<string, unknown>;
  const nav = navigator as Navigator & { deviceMemory?: number; locks?: unknown; storage?: { persist?: unknown } };
  let brotli = false;
  try {
    new DecompressionStream("brotli" as CompressionFormat);
    brotli = true;
  } catch {
    // not supported
  }
  return [
    { name: "IndexedDB", ok: "indexedDB" in w, note: "where canvases are kept" },
    { name: "Several tabs (Web Locks)", ok: !!nav.locks, note: "one tab writes, the others read" },
    { name: "BroadcastChannel", ok: "BroadcastChannel" in w, note: "tabs tell each other of changes" },
    { name: "OffscreenCanvas", ok: "OffscreenCanvas" in w, note: "thumbnails and screenshots" },
    { name: "createImageBitmap", ok: "createImageBitmap" in w, note: "decoding pictures" },
    { name: "Video decoding (WebCodecs)", ok: "VideoDecoder" in w, note: "frames of video files" },
    { name: "Brotli in the browser", ok: brotli, note: brotli ? "WOFF2 fonts unpack faster" : "WOFF2 fonts use the decoder of the app" },
    { name: "Persistent storage", ok: typeof nav.storage?.persist === "function", note: "ask the browser not to clear the data" },
    { name: "Clipboard images", ok: "ClipboardItem" in w, note: "copy a picture out" },
    { name: "Folder import", ok: "webkitdirectory" in document.createElement("input"), note: "import a folder" },
  ];
}

/** A text report of the session: version, browser, capabilities, quality and memory, settings that differ from the defaults, and the errors. */
export function diagnosticReport(extra: Record<string, unknown>): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines = [
    "canvast diagnostic report",
    `Made: ${new Date().toISOString()}`,
    `Version: ${typeof __CANVAST_VERSION__ === "string" ? __CANVAST_VERSION__ : "dev"}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} at ${window.devicePixelRatio || 1}x; window ${innerWidth}x${innerHeight}`,
    `Processors: ${navigator.hardwareConcurrency ?? "unknown"}; memory: ${nav.deviceMemory ?? "unknown"} GB`,
    "",
    "Capabilities:",
    ...capabilities().map((c) => `  ${c.ok ? "yes" : "NO "} ${c.name} (${c.note})`),
    "",
    ...Object.entries(extra).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
    "",
    `Errors this session (${log.length}):`,
    ...(log.length ? log.map((e) => `  ${new Date(e.at).toISOString()}  ${e.what}`) : ["  none"]),
    "",
    "This report holds no canvas content: only the numbers above.",
  ];
  return lines.join("\n");
}

declare const __CANVAST_VERSION__: string;
