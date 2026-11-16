import type { ResolvedCommand } from "./types";

/**
 * The rule every command follows (ADR 0205), as one check the commands unit test and the live audit share: a fixed id of the form
 * `area.action` (lower case, dots or colons between parts), a hint, a risk, and `exec` or `takes` (not the old `run`). Risky kinds of
 * work must say so: a command that deletes, or touches hidden items, a password or the whole workspace is `confirm` or `refused`.
 */
const RISKY = /\b(delete|erase for good|empty the trash|password)\b|\bhidden (items|folder)|\b(replace the workspace|switch workspace)\b/i;
const ID = /^[a-z][a-zA-Z0-9-]*([.:][a-zA-Z0-9][\w.:=\- ]*)+$/;

export function ruleProblems(all: readonly ResolvedCommand[]): Array<{ id: string; source: string; missing: string[] }> {
  const out: Array<{ id: string; source: string; missing: string[] }> = [];
  for (const c of all) {
    const missing: string[] = [];
    if (c.auto) missing.push("a fixed id");
    else if (!ID.test(c.id)) missing.push("an id of the form area.action");
    if (!c.hint) missing.push("a hint");
    if (!c.risk) missing.push("a risk");
    if (!c.exec && !c.takes) missing.push("exec");
    if (c.risk && c.risk !== "confirm" && c.risk !== "refused" && c.risk !== "read" && RISKY.test(c.title) && !/^(show|select|go to|open|lock)\b/i.test(c.title)) missing.push("risk confirm (it deletes or touches hidden items)");
    if (missing.length) out.push({ id: c.id, source: c.source, missing });
  }
  return out;
}
