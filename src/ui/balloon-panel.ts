import type { EditorState } from "../app/editor-state";
import { BALLOON_PRESETS, BODIES, BUMPY, TAIL_KINDS, boxShape, tailAngle, withNewTail, type BalloonSpec, type BalloonTail, type Box, type TailKind } from "../doc/balloon-geometry";
import { LINK_STYLES, type BalloonLink, type LinkStyle } from "../doc/balloon-link";
import { Ch, R, when } from "../gen/kit";
import type { Section } from "../gen/types";
import type { TextLook } from "../text/text-style";
import { panelHtml } from "./panel";
import { mountSettings, type SettingValue } from "./setting-rows";

export interface ShapeTextState { padX: number; padY: number; padR: number; padB: number; hide: boolean; align: string; valign: string; overflow: boolean }
export interface BalloonActions {
  selected(): { box: Box; spec: BalloonSpec } | null;
  change(f: (s: BalloonSpec, box: Box) => BalloonSpec, final: boolean): void;
  text(): ShapeTextState | null;
  setText(look: TextLook, final: boolean): void;
  link(): BalloonLink | null;
  setLink(p: Partial<BalloonLink>): void;
  canConnect(): boolean;
  connect(): void;
  toPath(): void;
  saveStyle(): void;
}

const BODY: Section = { title: "Body", items: [
  Ch("preset", "Preset", [["", "Custom"], ...BALLOON_PRESETS.map(([id, label]) => [id, label] as const)], "", true),
  Ch("body", "Shape", BODIES, "oval"),
  when("body", ["round", "octagon"], R("round", "Rounding", 0, 100, 35)),
  when("body", ["polygon"], R("sides", "Sides", 3, 24, 6)),
  when("body", BUMPY, R("bumps", "Bumps", 3, 48, 12)),
  when("body", BUMPY, R("depth", "Bump depth", 2, 60, 18)),
  R("wobble", "Hand-drawn", 0, 100, 0),
  R("double", "Double line", 0, 40, 0),
  R("seed", "Seed", 1, 999, 1),
] };
const tailSection = (many: number): Section => ({ title: "Tail", items: [
  ...(many > 1 ? [Ch("which", "Which", Array.from({ length: many }, (_, i) => [String(i), `Tail ${i + 1}`] as const), "0", true)] : []),
  Ch("tail", "Kind", TAIL_KINDS, "point", true),
  R("tailW", "Base width", 1, 100, 22),
  when("tail", ["bubbles"], R("bubbles", "Bubbles", 1, 12, 3)),
  when("tail", ["point", "curved"], R("belly", "Middle width", 0, 150, 50)),
  when("tail", ["curved"], R("bend", "Bend", -100, 100, 28)),
  when("tail", ["point", "curved"], R("tipRound", "Round tip", 0, 100, 0)),
  Ch("base", "Base", [["locked", "Locked"], ["follows", "Follows tip"]], "locked", true),
  when("base", ["locked"], R("baseAt", "Base at", -180, 180, 0)),
  when("base", ["follows"], R("shift", "Base shift", -68, 68, 0)),
] });
const TEXT: Section = { title: "Text", items: [
  Ch("across", "Across", [["left", "Left"], ["center", "Middle"], ["right", "Right"], ["justify", "Justify"]], "center", true),
  Ch("down", "Down", [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], "middle", true),
  R("padX", "Padding left", 0, 4, 0.4, 0.05),
  R("padR", "Padding right", 0, 4, 0.4, 0.05),
  R("padY", "Padding top", 0, 4, 0, 0.05),
  R("padB", "Padding bottom", 0, 4, 0, 0.05),
  Ch("over", "Too many words", [["show", "Show"], ["hide", "Hide"]], "show"),
] };
const LINK: Section = { title: "Connector", items: [
  Ch("linkStyle", "Kind", LINK_STYLES, "neck", true),
  R("linkW", "Width", 1, 100, 22),
  R("linkBend", "Bend", -100, 100, 0),
] };
const TEXT_KEYS = new Set(["across", "down", "padX", "padR", "padY", "padB", "over"]);
const LINK_KEYS = new Set(["linkStyle", "linkW", "linkBend"]);

const DEG = 180 / Math.PI;
const minSide = (b: Box): number => Math.min(Math.abs(b[2]), Math.abs(b[3])) || 1;

/** The numbers as the panel shows them. */
function shown(box: Box, s: BalloonSpec, ix: number): Record<string, SettingValue> {
  const t = s.tails[ix];
  return { double: s.double ?? 0, tipRound: t?.tipRound ?? 0, preset: "", which: String(ix), bubbles: t?.bubbles ?? 3, body: s.body, round: s.round, sides: s.sides, bumps: s.bumps, depth: s.depth, wobble: s.wobble, seed: s.seed, tail: t?.kind ?? "point", tailW: t ? Math.round((t.width / minSide(box)) * 100) : 22, bend: Math.round(t?.bend ?? 28), shift: Math.round((t?.shift ?? 0) * DEG), belly: Math.round(t?.belly ?? 50), base: t?.follow ? "follows" : "locked", baseAt: t ? Math.round(tailAngle(box, t) * DEG) : 0 };
}

/** Only what was changed goes onto each selected balloon. */
function applied(p: Readonly<Record<string, SettingValue>>, s: BalloonSpec, box: Box, ix: number): BalloonSpec {
  const whole = (k: string): number | undefined => (p[k] === undefined ? undefined : Math.round(p[k] as number));
  const tail = (t0: BalloonTail): BalloonTail => {
    // (the base stays where it is when it is locked or let go)
    const { follow: _f, ...fixed } = t0;
    const { c } = boxShape(box);
    const at = tailAngle(box, t0);
    const t: BalloonTail = p["base"] === "locked" ? { ...fixed, angle: at, shift: 0 } : p["base"] === "follows" ? { ...t0, follow: true, shift: at - Math.atan2(t0.tip[1] - c[1], t0.tip[0] - c[0]) } : t0;
    return {
    ...t,
    ...(p["tipRound"] !== undefined ? { tipRound: p["tipRound"] as number } : {}),
    ...(p["bubbles"] !== undefined ? { bubbles: Math.round(p["bubbles"] as number) } : {}),
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
    ...(p["double"] !== undefined ? { double: p["double"] as number } : {}),
    ...(whole("sides") !== undefined ? { sides: whole("sides")! } : {}),
    ...(whole("bumps") !== undefined ? { bumps: whole("bumps")! } : {}),
    ...(whole("seed") !== undefined ? { seed: whole("seed")! } : {}),
    tails: s.tails.map((t, i) => (i === ix ? tail(t) : t)),
  };
}

/** The panel of a balloon and of words in a shape: what is selected decides which groups it shows; the groups are the shared rows. */
export function mountBalloonPanel(host: HTMLElement, editor: EditorState, actions: BalloonActions): { toggle(): void } {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel balloon-panel";
  panel.setAttribute("aria-label", "Speech balloon");
  panel.dataset["testid"] = "balloon-panel";
  panel.hidden = true;
  const btn = (id: string, label: string, tip: string): string => `<button type="button" class="adj-map-edit" data-bl="${id}" title="${tip}">${label}</button>`;
  panel.innerHTML = panelHtml({
    title: "Speech balloon",
    body: `<div data-bl-rows></div><p class="adj-note" data-bl-over hidden>Some words do not fit in this shape.</p>`,
    foot: `<div class="adj-foot">${btn("addtail", "Add tail", "A new tail on this balloon")}${btn("deltail", "Remove tail", "Take this tail away")}${btn("fit", "Fit text to shape", "The biggest size at which all the words fit")}${btn("connect", "Connect balloons", "Join the selected balloons, each to the next")}${btn("save", "Save as style", "Keep this balloon's look in the Styles panel")}${btn("topath", "Convert to path", "An ordinary path, for editing its nodes")}</div>`,
  });
  host.append(panel);
  const rowsEl = panel.querySelector<HTMLElement>("[data-bl-rows]")!, titleEl = panel.querySelector<HTMLElement>("h2")!;
  const b = (id: string): HTMLButtonElement => panel.querySelector<HTMLButtonElement>(`[data-bl="${id}"]`)!;
  let values: Record<string, SettingValue> = {};
  let sections: Section[] = [];
  let drawn = "";
  let pending: Record<string, SettingValue> = {};
  let timer = 0;
  let ix = 0;
  const lookOf = (p: Readonly<Record<string, SettingValue>>): TextLook => {
    // (the four together: a side that was never set follows another, and must not change when that one does)
    const anyPad = ["padX", "padR", "padY", "padB"].some((k) => p[k] !== undefined);
    const opts = { ...(anyPad ? { padX: values["padX"] as number, padR: values["padR"] as number, padY: values["padY"] as number, padB: values["padB"] as number } : {}), ...(p["over"] !== undefined ? { hide: p["over"] === "hide" } : {}) };
    return { ...(p["across"] !== undefined ? { align: p["across"] as "left" } : {}), ...(p["down"] !== undefined ? { valign: p["down"] as "top" } : {}), ...(Object.keys(opts).length ? { shapeOpts: opts } : {}) };
  };
  const send = (p: Record<string, SettingValue>, final: boolean): void => {
    const shape: Record<string, SettingValue> = {}, text: Record<string, SettingValue> = {}, link: Record<string, SettingValue> = {};
    for (const [k, v] of Object.entries(p)) (TEXT_KEYS.has(k) ? text : LINK_KEYS.has(k) ? link : shape)[k] = v;
    const at = ix;
    if (Object.keys(shape).length) actions.change((s, box) => applied(shape, s, box, at), final);
    if (Object.keys(text).length) actions.setText(lookOf(text), final);
    if (final && Object.keys(link).length) actions.setLink({ ...(link["linkStyle"] !== undefined ? { style: link["linkStyle"] as LinkStyle } : {}), ...(link["linkW"] !== undefined ? { width: link["linkW"] as number } : {}), ...(link["linkBend"] !== undefined ? { bend: link["linkBend"] as number } : {}) });
  };
  const flush = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    const p = pending;
    pending = {};
    if (Object.keys(p).length) send(p, true);
  };
  const put = (changes: Record<string, SettingValue>): void => {
    Object.assign(values, changes);
    Object.assign(pending, changes);
    send({ ...pending }, false);
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 200); // (a drag along a slider is one undo step)
  };
  const rows = mountSettings(rowsEl, {
    sections: () => sections,
    get: (k) => values[k]!,
    set: (k, v) => {
      if (k === "which") {
        flush();
        ix = Number(v);
        drawn = "";
        sync();
        return;
      }
      if (k === "preset") {
        const p = BALLOON_PRESETS.find(([id]) => id === v);
        if (p) put({ body: p[2], tail: p[3] });
        values["preset"] = "";
        rows.build();
        return;
      }
      put({ [k]: v });
      if (k === "body" || k === "tail" || k === "base") rows.build();
    },
    reset: (keys) => put(Object.fromEntries(keys.filter((s) => s.k !== "preset" && s.k !== "which").map((s) => [s.k, s.def]))),
    idPrefix: "bl-n-",
  });
  const sync = (): void => {
    if (panel.hidden || timer) return;
    const cur = actions.selected(), text = actions.text(), link = actions.link();
    titleEl.textContent = cur ? "Speech balloon" : text ? "Text in shape" : link ? "Balloon connector" : "Speech balloon";
    b("addtail").hidden = !cur;
    b("deltail").hidden = !cur?.spec.tails.length;
    b("fit").hidden = !text;
    b("connect").hidden = !actions.canConnect();
    b("topath").hidden = !cur;
    b("save").hidden = !cur;
    panel.querySelector<HTMLElement>("[data-bl-over]")!.hidden = !text?.overflow;
    if (!cur && !text && !link) {
      drawn = "";
      rowsEl.innerHTML = `<p class="adj-note">Select a speech balloon or a text in a shape.</p>`;
      return;
    }
    ix = cur ? Math.max(0, Math.min(ix, cur.spec.tails.length - 1)) : 0;
    sections = [...(cur ? [BODY, ...(cur.spec.tails.length ? [tailSection(cur.spec.tails.length)] : [])] : []), ...(text ? [TEXT] : []), ...(link ? [LINK] : [])];
    values = {
      ...(cur ? shown(cur.box, cur.spec, ix) : {}),
      ...(text ? { across: text.align, down: text.valign, padX: text.padX, padR: text.padR, padY: text.padY, padB: text.padB, over: text.hide ? "hide" : "show" } : {}),
      ...(link ? { linkStyle: link.style, linkW: link.width, linkBend: link.bend } : {}),
    };
    const now = JSON.stringify(values);
    if (now !== drawn && !rowsEl.contains(document.activeElement)) { // (never under a field that is being typed in)
      drawn = now;
      rows.build();
    }
  };
  panel.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-bl]")?.dataset["bl"];
    if (id) flush();
    if (id === "addtail") actions.change((s, box) => withNewTail(box, s), true);
    else if (id === "deltail") { const at = ix; actions.change((s) => ({ ...s, tails: s.tails.filter((_, i) => i !== at) }), true); }
    else if (id === "fit") actions.setText({ fitShape: true }, true);
    else if (id === "connect") actions.connect();
    else if (id === "topath") actions.toPath();
    else if (id === "save") actions.saveStyle();
  });
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
