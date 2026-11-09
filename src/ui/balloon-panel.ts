import type { EditorState } from "../app/editor-state";
import { BODIES, BUMPY, TAIL_KINDS, boxShape, tailAngle, type BalloonSpec, type BalloonTail, type Box, type TailKind } from "../doc/balloon-geometry";
import { Ch, R, when } from "../gen/kit";
import type { Section } from "../gen/types";
import { panelHtml } from "./panel";
import { mountSettings, type SettingValue } from "./setting-rows";

export interface BalloonActions {
  selected(): { box: Box; spec: BalloonSpec } | null;
  change(f: (s: BalloonSpec, box: Box) => BalloonSpec, final: boolean): void;
}

const SECTIONS: readonly Section[] = [
  { title: "Body", items: [
    Ch("body", "Shape", BODIES, "oval"),
    when("body", ["round", "octagon"], R("round", "Rounding", 0, 100, 35)),
    when("body", ["polygon"], R("sides", "Sides", 3, 24, 6)),
    when("body", BUMPY, R("bumps", "Bumps", 3, 48, 12)),
    when("body", BUMPY, R("depth", "Bump depth", 2, 60, 18)),
    R("wobble", "Hand-drawn", 0, 100, 0),
    R("seed", "Seed", 1, 999, 1),
  ] },
  { title: "Tail", items: [
    Ch("tail", "Kind", TAIL_KINDS, "point", true),
    R("tailW", "Base width", 1, 100, 22),
    when("tail", ["curved"], R("bend", "Bend", -100, 100, 28)),
    R("belly", "Middle width", 0, 150, 50),
    Ch("base", "Base", [["locked", "Locked"], ["follows", "Follows tip"]], "locked"),
    when("base", ["locked"], R("baseAt", "Base at", -180, 180, 0)),
    when("base", ["follows"], R("shift", "Base shift", -68, 68, 0)),
  ] },
];

const DEG = 180 / Math.PI;
const minSide = (b: Box): number => Math.min(Math.abs(b[2]), Math.abs(b[3])) || 1;

/** The numbers as the panel shows them. */
function shown(box: Box, s: BalloonSpec): Record<string, SettingValue> {
  const t = s.tails[0];
  return { body: s.body, round: s.round, sides: s.sides, bumps: s.bumps, depth: s.depth, wobble: s.wobble, seed: s.seed, tail: t?.kind ?? "point", tailW: t ? Math.round((t.width / minSide(box)) * 100) : 22, bend: Math.round(t?.bend ?? 28), shift: Math.round((t?.shift ?? 0) * DEG), belly: Math.round(t?.belly ?? 50), base: t?.follow ? "follows" : "locked", baseAt: t ? Math.round(tailAngle(box, t) * DEG) : 0 };
}

/** Only what was changed goes onto each selected balloon. */
function applied(p: Readonly<Record<string, SettingValue>>, s: BalloonSpec, box: Box): BalloonSpec {
  const whole = (k: string): number | undefined => (p[k] === undefined ? undefined : Math.round(p[k] as number));
  const tail = (t0: BalloonTail): BalloonTail => {
    // (the base stays where it is when it is locked or let go)
    const { follow: _f, ...fixed } = t0;
    const { c } = boxShape(box);
    const at = tailAngle(box, t0);
    const t: BalloonTail = p["base"] === "locked" ? { ...fixed, angle: at, shift: 0 } : p["base"] === "follows" ? { ...t0, follow: true, shift: at - Math.atan2(t0.tip[1] - c[1], t0.tip[0] - c[0]) } : t0;
    return {
    ...t,
    ...(p["belly"] !== undefined ? { belly: p["belly"] as number } : {}),
    ...(p["baseAt"] !== undefined && !t.follow ? { angle: (p["baseAt"] as number) / DEG } : {}),
    ...(p["tail"] !== undefined ? { kind: p["tail"] as TailKind } : {}),
    ...(p["tailW"] !== undefined ? { width: ((p["tailW"] as number) / 100) * minSide(box) } : {}),
    ...(p["bend"] !== undefined ? { bend: p["bend"] as number } : {}),
    ...(p["shift"] !== undefined ? { shift: (p["shift"] as number) / DEG } : {}),
    };
  };
  return {
    ...s,
    ...(p["body"] !== undefined ? { body: p["body"] as string } : {}),
    ...(p["round"] !== undefined ? { round: p["round"] as number } : {}),
    ...(p["depth"] !== undefined ? { depth: p["depth"] as number } : {}),
    ...(p["wobble"] !== undefined ? { wobble: p["wobble"] as number } : {}),
    ...(whole("sides") !== undefined ? { sides: whole("sides")! } : {}),
    ...(whole("bumps") !== undefined ? { bumps: whole("bumps")! } : {}),
    ...(whole("seed") !== undefined ? { seed: whole("seed")! } : {}),
    tails: s.tails.map((t, i) => (i === 0 ? tail(t) : t)),
  };
}

/** The Speech balloon panel: the numbers of the selected balloons, in the shared rows. */
export function mountBalloonPanel(host: HTMLElement, editor: EditorState, actions: BalloonActions): { toggle(): void } {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel balloon-panel";
  panel.setAttribute("aria-label", "Speech balloon");
  panel.dataset["testid"] = "balloon-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({ title: "Speech balloon", body: `<div data-bl-rows></div>` });
  host.append(panel);
  const rowsEl = panel.querySelector<HTMLElement>("[data-bl-rows]")!;
  let values: Record<string, SettingValue> = {};
  let drawn = "";
  let pending: Record<string, SettingValue> = {};
  let timer = 0;
  const flush = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    const p = pending;
    pending = {};
    if (Object.keys(p).length) actions.change((s, box) => applied(p, s, box), true);
  };
  const put = (changes: Record<string, SettingValue>): void => {
    Object.assign(values, changes);
    Object.assign(pending, changes);
    const p = { ...pending };
    actions.change((s, box) => applied(p, s, box), false);
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 200); // (a drag along a slider is one undo step)
  };
  const rows = mountSettings(rowsEl, {
    sections: () => SECTIONS,
    get: (k) => values[k]!,
    set: (k, v) => {
      put({ [k]: v });
      if (k === "body" || k === "tail" || k === "base") rows.build();
    },
    reset: (keys) => put(Object.fromEntries(keys.map((s) => [s.k, s.def]))),
    idPrefix: "bl-n-",
  });
  const sync = (): void => {
    if (panel.hidden || timer) return;
    const cur = actions.selected();
    if (!cur) {
      drawn = "";
      rowsEl.innerHTML = `<p class="adj-note">Select a speech balloon.</p>`;
      return;
    }
    values = shown(cur.box, cur.spec);
    const now = JSON.stringify(values);
    if (now !== drawn) {
      drawn = now;
      rows.build();
    }
  };
  panel.querySelector("[data-close]")!.addEventListener("click", () => {
    panel.hidden = true;
  });
  editor.subscribe(sync);
  return {
    toggle: () => {
      flush();
      panel.hidden = !panel.hidden;
      drawn = "";
      sync();
    },
  };
}
