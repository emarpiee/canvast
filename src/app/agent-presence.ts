import type { CommandRegistry } from "../commands/registry";
import { MAX_BATCH, pressCommand } from "../commands/registry";
import type { ScreenPoint } from "../core/camera";
import type { DocumentStore } from "../doc/document-store";
import { plural } from "../doc/plural";
import type { SettingsStore } from "../settings/settings";
import { desktopBridge } from "../storage/desktop-bridge";
import { confirmDialog, listDialog } from "../ui/confirm";
import { esc } from "../ui/format";
import { ICONS } from "../ui/icons";
import type { Touched } from "./agent-link";
import { mountAgentLink } from "./agent-link";
import type { EditorState } from "./editor-state";
import type { ViewState } from "./view-state";

/**
 * The link to AI agents as the person sees it (ADR 0205): the confirm dialog of a risky run, the agent's chip and pointer, what it did
 * (the activity list), and the link itself (`mountAgentLink`), with the code the canvast tools keep on this computer (desktop).
 */
export interface AgentPresenceDeps {
  registry: CommandRegistry;
  settings: SettingsStore;
  /** The main view's canvas: what an agent's run touched, and where its pointer goes. */
  doc: DocumentStore;
  editor: EditorState;
  view: ViewState;
  appView(): string;
  setView(v: "canvas"): void;
  agentPointerAt(): ScreenPoint | null;
}

export function mountAgentPresence(d: AgentPresenceDeps): { watchItems: () => () => Touched; agentRan(method: string, params: unknown, result: unknown): void; showAgentChip(connected: boolean): void } {
  const { registry, settings, doc, editor, view } = d;
  // An outside caller's risky run asks the person here (ADR 0205); only the person answers. The link to AI agents opens while it is on.
  registry.setConfirmer((c, options) => confirmDialog({
    title: `An AI agent wants to: ${c.title}`,
    lines: [c.hint ?? "", ...(Object.keys(options).length ? [`With: ${JSON.stringify(options).slice(0, 300)}`] : []), "Allow it only if you asked the agent for this."],
    confirmLabel: "Allow",
    danger: true,
  }));
  // The desktop app pairs by itself: the canvast tools on this computer keep their code where the app can read it (desktop/tools-home.ts).
  let toolsCode = "";
  const readToolsCode = (): void => void desktopBridge()?.agentCode?.().then((c) => {
    if (c && c !== toolsCode) {
      toolsCode = c;
      agentLink.sync();
    }
  });
  // What an agent's run did to the items (told in its answer, and where its pointer goes): from the steps the canvas stored meanwhile.
  const watchItems = (): (() => Touched) => {
    // (told from the ids there were when it started: a step another part stores in between never makes a new item look changed)
    const was = new Set([...doc.all()].map((o) => o.id));
    const touched = new Set<string>();
    const off = doc.subscribe((source, ids) => void (source !== "load" && ids && ids.forEach((id) => touched.add(id))));
    return () => {
      off();
      const t = [...touched];
      return { made: t.filter((id) => !was.has(id) && doc.get(id)), changed: t.filter((id) => was.has(id) && doc.get(id)), removed: t.filter((id) => was.has(id) && !doc.get(id)) };
    };
  };
  /** What agents did, newest last (Settings never grows with it: the AI agent button opens it in a list). */
  const agentLog: Array<{ at: number; title: string; ok: boolean; error?: string; ids: string[] }> = [];
  let agentLoop = 0;
  /** Its pointer moves to what it touched, or to the selection; the info bar says what it did. */
  const agentRan = (method: string, params: unknown, result: unknown): void => {
    const p = (params ?? {}) as { id?: unknown; steps?: Array<{ id?: unknown }> };
    const r = (result ?? {}) as { ok?: boolean; error?: string; made?: string[]; changed?: string[]; results?: Array<{ ok: boolean; error?: string; step?: number }> };
    const title = (id: unknown): string => registry.get(String(id))?.title ?? String(id);
    const ids = [...(r.made ?? []), ...(r.changed ?? [])];
    // (a batch's answer lists every step, or by default only those that failed or read something, each by its number)
    const said = new Map((r.results ?? []).map((x, i) => [x.step ?? i, x]));
    const stop = (p as { stopOnError?: unknown }).stopOnError === false ? undefined : [...said].find(([, x]) => x.ok === false)?.[0];
    const done = method === "batch" ? (p.steps ?? []).slice(0, stop === undefined ? MAX_BATCH : stop + 1).map((st, i) => ({ title: title(st.id), res: said.get(i) ?? { ok: true } })) : [];
    const steps = method === "run" ? [{ title: title(p.id), res: r }] : done.length ? done : [{ title: method === "batch" ? "Several commands" : "Read the list of commands", res: r.ok === false ? r : { ok: true } }];
    if (method === "list") return;
    // (one row a call: a batch's steps are counted by kind, so a long batch is one line)
    const counts = new Map<string, number>();
    for (const st of steps) counts.set(st.title, (counts.get(st.title) ?? 0) + 1);
    const failed = steps.find((st) => st.res.ok === false);
    agentLog.push({ at: Date.now(), title: [...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(" · "), ok: r.ok !== false && !failed, ...((failed?.res.error ?? r.error) ? { error: failed?.res.error ?? r.error } : {}), ids });
    if (agentLog.length > 500) agentLog.splice(0, agentLog.length - 500);
    agentList?.refresh();
    const last = steps[steps.length - 1];
    const words = steps.length > 1 ? `${last?.title ?? ""} (${plural(steps.length, "step")})` : (last?.title ?? "");
    editor.message = r.ok === false ? `AI agent: ${words}: ${r.error ?? last?.res.error ?? "not done"}` : `AI agent: ${words}`;
    const at = performance.now();
    const shown = ids.length ? ids : d.appView() === "canvas" ? [...editor.selection] : [];
    editor.agentMark = { ids: shown, title: words, at, until: at + 4000, from: view.glideMs ? d.agentPointerAt() : null }; // (reduced motion: it jumps)
    const loop = ++agentLoop;
    // (frames only while the pointer glides and fades: one frame between)
    const frames = (): void => {
      const m = editor.agentMark;
      if (loop !== agentLoop || !m) return;
      const now = performance.now();
      if (now >= m.until) return void ((editor.agentMark = null), editor.redraw());
      editor.redraw();
      if (now < m.at + 350 || now > m.until - 600 || m.off) requestAnimationFrame(frames);
      else setTimeout(frames, m.until - 600 - now);
    };
    frames();
    editor.changed();
  };
  let agentList: { refresh(): void } | null = null;
  const agentChip = document.querySelector<HTMLButtonElement>('[data-testid="agent-chip"]');
  const showAgentChip = (connected: boolean): void => {
    if (!agentChip) return;
    agentChip.hidden = !settings.get("agents.on");
    agentChip.dataset["state"] = connected ? "connected" : "waiting";
    const words = connected ? "AI agent: connected. What it did" : "AI agent: waiting for one. What it did";
    agentChip.setAttribute("aria-label", words);
    agentChip.title = words;
  };
  agentChip?.addEventListener("click", () => void pressCommand("agents.activity"));
  registry.setProvider("agents", () => [{
    id: "agents.activity", group: "AI agents", kind: "settings", title: "What the AI agent did", hint: "Its last actions, newest first", icon: ICONS.tabAgents, risk: "read",
    why: () => null,
    exec: () => {
      agentList = listDialog({
        title: "What the AI agent did",
        testid: "agent-activity-dialog",
        lines: [agentChip?.dataset["state"] === "connected" ? "An AI agent is connected. Turn it off in Settings > AI agents." : "No AI agent is connected now (Settings > AI agents)."], // (as the button shows it)
        body: () => `<ul class="confirm-list agent-log">${agentLog.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => `<li><time>${new Date(e.at).toLocaleTimeString()}</time><span class="agent-log-what">${e.ok ? "" : "❌ "}${esc(e.title)}${e.error ? `: ${esc(e.error)}` : ""}</span>${e.ids.length && e.ids.some((id) => doc.get(id)) ? `<button type="button" class="set-done" data-agent-go="${i}">Go there</button>` : ""}</li>`).join("") || "<li>Nothing yet.</li>"}</ul>`,
        onClick: (t, _refresh, close) => {
          const i = t.closest<HTMLElement>("[data-agent-go]")?.dataset["agentGo"];
          const e = i === undefined ? undefined : agentLog[Number(i)];
          if (!e) return;
          close();
          d.setView("canvas");
          void pressCommand("select.items", { ids: e.ids.filter((id) => doc.get(id)) });
          void pressCommand("view.fitSelection");
        },
      });
      return { ok: true };
    },
  }]);
  const agentLink = mountAgentLink({
    registry,
    on: () => settings.get("agents.on"),
    code: () => settings.get("agents.code") || toolsCode, // (typed, or the desktop app's: the code the canvast tools made on this computer)
    readOnly: () => settings.get("agents.readOnly"),
    say: (text) => { editor.message = text; editor.changed(); },
    changed: showAgentChip,
    watch: watchItems,
    ran: agentRan,
  });
  showAgentChip(false);
  settings.subscribe(() => {
    if (settings.get("agents.on")) readToolsCode(); // (the tools may have made their code since)
    agentLink.sync();
    showAgentChip(agentLink.connected);
  });
  if (settings.get("agents.on")) readToolsCode();
  return { watchItems, agentRan, showAgentChip };
}
