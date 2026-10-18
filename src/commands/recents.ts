/** The commands used last, kept on this device in `localStorage` (a convenience: blocked storage just means an empty list). */
const KEY = "canvast.palette.recent";
const MAX = 8;

export const loadRecentCommands = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
};

/** Put a command first (once). */
export const rememberCommand = (id: string): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...loadRecentCommands().filter((x) => x !== id)].slice(0, MAX)));
  } catch {
    // storage unavailable
  }
};
