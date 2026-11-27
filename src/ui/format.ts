/** Escape text for insertion into HTML. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Human-readable byte count (binary units). */
export const fmtBytes = (n: number): string =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GiB` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} B`;

/** When something was last changed, in words: "just now", "5 min ago", "3 h ago", "Yesterday", a weekday within the week, else the date. */
export function ago(t: number, now = Date.now()): string {
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  const d = new Date(t);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}
