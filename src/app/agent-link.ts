import type { CommandRegistry } from "../commands/registry";
import { MAX_BATCH } from "../commands/registry";
import type { Options } from "../commands/types";

/**
 * The link to AI agents (ADR 0205). An agent (an MCP client) talks to the canvast tools on this computer (`canvast-tools mcp`), and the
 * tools pass its calls on to this page over one connection to 127.0.0.1, which the page opens only while Settings > AI agents is on and
 * with the pairing code the tools showed. The page is the one that connects (a page cannot be a server); the tools answer only it.
 *
 * What comes over it is a request `{ id, method, params }`: `list` (the commands, what an agent reads), `run` (one command by id),
 * `batch` (several in order). The answer is `{ id, result }` or `{ id, error }`. Every run is the agent's (`caller: "agent"`): what asks the
 * person asks here, what only the person may do is refused, and read-only refuses everything but reads.
 */
export const AGENT_PORT = 47380;

export interface AgentLinkDeps {
  registry: CommandRegistry;
  /** Settings > AI agents, read each time (the switch, the code, read-only). */
  on(): boolean;
  code(): string;
  readOnly(): boolean;
  /** Tell the person (connected, gone). */
  say(text: string): void;
  /** Whether it is connected changed (what shows it on the screen). */
  changed?(connected: boolean): void;
  /** Start noting what the canvas's items do; the function returned stops and tells (what a run made, changed or removed). */
  watch?: Watch;
  /** A call was answered: what it asked and what came of it (what shows the person where the agent works). */
  ran?(method: string, params: unknown, result: unknown): void;
}

export type Touched = { made: string[]; changed: string[]; removed: string[] };
export type Watch = () => () => Touched;

export interface AgentLink {
  readonly connected: boolean;
  /** Read the settings again: connect, or close. */
  sync(): void;
}

/** How a request is answered: the one place an agent's call becomes a command's run. */
export async function answer(registry: CommandRegistry, method: string, params: unknown, readOnly: boolean, watch?: Watch): Promise<unknown> {
  registry.readOnlyCallers = readOnly;
  const p = (params ?? {}) as { id?: unknown; options?: unknown; steps?: unknown; filter?: unknown; stopOnError?: unknown };
  if (method === "list") return registry.list(typeof p.filter === "string" ? p.filter : "");
  // (what the run did to the items, told in its answer when the command does not say it itself: the agent sees what it made)
  const told = async <R extends { ok: boolean }>(run: Promise<R>): Promise<R> => {
    const stop = watch?.();
    const r = await run;
    const t = stop?.();
    if (!t || !r.ok) return r;
    const out: Record<string, unknown> = { ...r };
    for (const k of ["made", "changed", "removed"] as const) if (t[k].length && out[k] === undefined) out[k] = t[k];
    return out as unknown as R;
  };
  if (method === "run") {
    if (typeof p.id !== "string") throw new Error('"run" needs the id of a command.');
    return told(registry.execute(p.id, (p.options ?? {}) as Options, { caller: "agent" }));
  }
  if (method === "batch") {
    if (!Array.isArray(p.steps)) throw new Error('"batch" needs its steps: [{ id, options }].');
    if (p.steps.length > MAX_BATCH) throw new Error(`A batch has at most ${MAX_BATCH} steps.`);
    return told(registry.batch(p.steps as Array<{ id: string; options?: Options }>, { caller: "agent" }, p.stopOnError !== false));
  }
  throw new Error(`There is no method "${method}": list, run or batch.`);
}

export function mountAgentLink(deps: AgentLinkDeps): AgentLink {
  let ws: WebSocket | null = null;
  let connected = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let usedCode = "";
  const set = (on: boolean): void => {
    if (connected === on) return;
    connected = on;
    deps.changed?.(on);
  };
  const close = (): void => {
    if (retry) clearTimeout(retry);
    retry = null;
    const was = ws;
    ws = null;
    if (was) {
      was.onclose = null;
      was.close();
    }
    if (connected) deps.say("The AI agent link is closed.");
    set(false);
  };
  const open = (): void => {
    const code = deps.code().trim();
    if (!code) return;
    usedCode = code;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`ws://127.0.0.1:${AGENT_PORT}/canvast?code=${encodeURIComponent(code)}`);
    } catch {
      return void (retry = setTimeout(open, 3000));
    }
    ws = sock;
    sock.onopen = () => {
      set(true);
      deps.say("An AI agent is connected (Settings > AI agents).");
    };
    sock.onmessage = (e) => {
      let req: { id?: unknown; method?: unknown; params?: unknown };
      try {
        req = JSON.parse(String(e.data)) as typeof req;
      } catch {
        return;
      }
      const id = req.id;
      void answer(deps.registry, String(req.method), req.params, deps.readOnly(), deps.watch).then(
        (result) => {
          deps.ran?.(String(req.method), req.params, result);
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id, result }));
        },
        (err: unknown) => {
          const error = (err as Error)?.message ?? String(err);
          deps.ran?.(String(req.method), req.params, { ok: false, error });
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id, error }));
        },
      );
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (connected) deps.say("The AI agent disconnected.");
      set(false);
      if (deps.on()) retry = setTimeout(open, 3000); // (the tools start and stop with the agent: try again while it is on)
    };
    sock.onerror = () => undefined; // (the close that follows tries again)
  };
  const sync = (): void => {
    const want = deps.on() && !!deps.code().trim();
    if (!want) return close();
    if (ws && usedCode !== deps.code().trim()) close();
    if (!ws && !retry) open();
  };
  sync();
  return {
    get connected() {
      return connected;
    },
    sync,
  };
}
