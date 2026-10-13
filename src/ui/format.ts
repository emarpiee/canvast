/** Escape text for insertion into HTML. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Human-readable byte count (binary units). */
export const fmtBytes = (n: number): string =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GiB` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} B`;
