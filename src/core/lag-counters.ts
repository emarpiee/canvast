/** What the lag monitor counts (temporary, see app/lag-monitor.ts): how often the costly things ran. A plain add, so counting costs nothing. */
export const lagCounts: Record<string, number> = {};
export const lagCount = (name: string, n = 1): void => void (lagCounts[name] = (lagCounts[name] ?? 0) + n);
