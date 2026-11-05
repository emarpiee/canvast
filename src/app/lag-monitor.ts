import { lagCounts } from "../core/lag-counters";
import { desktopBridge } from "../storage/desktop-bridge";

// A temporary monitor, to find out what makes a machine lag: every few seconds what the page did, for the main process to log beside each process's use of the processor and
// memory. Counts and timings only: no file names, nothing that is in the workspace, nothing sent anywhere. Remove it (and lag-counters.ts, the bridge's lagSample) when found.

const EVERY_MS = 5000;
/** The long frames kept for each sample, the longest first. */
const KEEP_LONG = 5;

export function startLagMonitor(info: () => Record<string, string | number | boolean>, say: (text: string) => void): void {
  const bridge = desktopBridge();
  if (!bridge?.lagSample) return;
  let long = 0, longMs = 0;
  let worst: Array<{ ms: number; scripts: Array<{ fn: string; ms: number }> }> = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { scripts?: Array<{ sourceFunctionName?: string; invoker?: string; duration: number }> }>) {
        long++;
        longMs += e.duration;
        worst.push({ ms: Math.round(e.duration), scripts: (e.scripts ?? []).sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => ({ fn: `${s.invoker ?? ""} ${s.sourceFunctionName ?? ""}`.trim().slice(0, 60), ms: Math.round(s.duration) })) });
      }
      worst = worst.sort((a, b) => b.ms - a.ms).slice(0, KEEP_LONG);
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {
    // (a browser without it: the counts still say much)
  }
  let last: Record<string, number> = {};
  setInterval(() => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(lagCounts)) if (v !== (last[k] ?? 0)) counts[k] = v - (last[k] ?? 0);
    last = { ...lagCounts };
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    bridge.lagSample!(JSON.stringify({ ...info(), shown: document.visibilityState === "visible", counts, heapMB: heap ? Math.round(heap / 2 ** 20) : null, long: { n: long, ms: Math.round(longMs), worst } }));
    long = longMs = 0;
    worst = [];
  }, EVERY_MS);
  void bridge.lagFile?.().then((path) => path && say(`Lag monitor on: it logs what the app does, no file names, to ${path}`));
}
