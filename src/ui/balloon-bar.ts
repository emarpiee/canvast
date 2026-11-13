import { BALLOON_PRESETS, BODIES, BUMPY, TAIL_KINDS, boxShape, tailAngle, withNewTail, type BalloonSpec, type BalloonTail, type Box, type TailKind } from "../doc/balloon-geometry";
import { LINK_STYLES, type BalloonLink, type LinkStyle } from "../doc/balloon-link";
import { Ch, R, when } from "../gen/kit";
import type { Setting } from "../gen/types";
import type { TextLook } from "../text/text-style";
import { esc } from "./format";
import { ICONS } from "./icons";

/**
 * A speech balloon's options and those of a text in a shape, in the Properties bar (ADR 0198; they were a panel of their own): four groups,
 * each a section and so a chip by the selection, its options a form there: Body, Tail, Text in shape, Connector. One set of controls, built
 * once (the bar is moved into a chip's form, never copied); what does not apply to what is selected is hidden, and an empty group with it.
 */
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

/** A control: the setting, and its full name in a chip's form (its short word stays in the bar). */
type Ctl = readonly [Setting, string];
const BODY: readonly Ctl[] = [
  [Ch("body", "Shape", BODIES, "oval"), "Body shape"],
  [Ch("preset", "Preset", [["", "Custom"], ...BALLOON_PRESETS.map(([id, label]) => [id, label] as const)], ""), "Preset"],
  [when("body", ["round", "octagon"], R("round", "Rounding", 0, 100, 35)), "Rounding"],
  [when("body", ["polygon"], R("sides", "Sides", 3, 24, 6)), "Sides"],
  [when("body", BUMPY, R("bumps", "Bumps", 3, 48, 12)), "Bumps"],
  [when("body", BUMPY, R("depth", "Bump depth", 2, 60, 18)), "Bump depth"],
  [R("wobble", "Hand-drawn", 0, 100, 0), "Hand-drawn"],
  [R("double", "Double line", 0, 40, 0), "Double line"],
  [R("seed", "Seed", 1, 999, 1), "Seed"],
];
const TAIL: readonly Ctl[] = [
  [Ch("tail", "Kind", TAIL_KINDS, "point"), "Tail kind"],
  [Ch("which", "Which", [["0", "Tail 1"]], "0"), "Which tail"],
  [R("tailW", "Base", 1, 100, 22), "Tail base width"],
  [when("tail", ["bubbles"], R("bubbles", "Bubbles", 1, 12, 3)), "Bubbles"],
  [when("tail", ["point", "curved"], R("belly", "Middle", 0, 150, 50)), "Tail middle width"],
  [when("tail", ["curved"], R("bend", "Bend", -100, 100, 28)), "Tail bend"],
  [when("tail", ["point", "curved"], R("tipRound", "Tip", 0, 100, 0)), "Round tip"],
  [Ch("base", "Base", [["locked", "Locked"], ["follows", "Follows tip"]], "locked"), "Tail base"],
  [when("base", ["locked"], R("baseAt", "At", -180, 180, 0)), "Base at"],
  [when("base", ["follows"], R("shift", "Shift", -68, 68, 0)), "Base shift"],
];
const TEXT: readonly Ctl[] = [
  [Ch("across", "Across", [["left", "Left"], ["center", "Middle"], ["right", "Right"], ["justify", "Justify"]], "center"), "Text across"],
  [Ch("down", "Down", [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], "middle"), "Text down"],
  [R("padX", "Left", 0, 4, 0.4, 0.05), "Padding left"],
  [R("padR", "Right", 0, 4, 0.4, 0.05), "Padding right"],
  [R("padY", "Top", 0, 4, 0, 0.05), "Padding top"],
  [R("padB", "Bottom", 0, 4, 0, 0.05), "Padding bottom"],
  [Ch("over", "Too much", [["show", "Show"], ["hide", "Hide"]], "show"), "Too much text"],
];
const LINK: readonly Ctl[] = [
  [Ch("linkStyle", "Kind", LINK_STYLES, "neck"), "Connector kind"],
  [R("linkW", "Width", 1, 100, 22), "Connector width"],
  [R("linkBend", "Bend", -100, 100, 0), "Connector bend"],
];
const ALL = [...BODY, ...TAIL, ...TEXT, ...LINK];
const TEXT_KEYS = new Set(TEXT.map(([s]) => s.k));
const LINK_KEYS = new Set(LINK.map(([s]) => s.k));
/** The buttons of a group: what it does at once (Add tail...), as rows of its chip's form. */
const BUTTONS: Record<string, ReadonlyArray<readonly [id: string, name: string, title: string, icon: string]>> = {
  body: [
    ["connect", "Connect balloons", "Join the selected balloons, each to the next", ICONS.balloonConnector],
    ["save", "Save as style", "Keep this balloon's look in the Styles panel", ICONS.save],
    ["topath", "Convert to path", "An ordinary path, for editing its nodes", ICONS.replace],
  ],
  tail: [
    ["addtail", "Add tail", "A new tail on this balloon", ICONS.tailAdd],
    ["deltail", "Remove tail", "Take this tail away", ICONS.tailRemove],
  ],
  text: [["fit", "Fit text to shape", "The biggest size at which all the text fits", ICONS.fitTextToShape]],
  link: [],
};

const DEG = 180 / Math.PI;
const minSide = (b: Box): number => Math.min(Math.abs(b[2]), Math.abs(b[3])) || 1;

/** The numbers as the bar shows them. */
function shown(box: Box, s: BalloonSpec, ix: number): Record<string, string | number> {
  const t = s.tails[ix];
  return { double: s.double ?? 0, tipRound: t?.tipRound ?? 0, preset: "", which: String(ix), bubbles: t?.bubbles ?? 3, body: s.body, round: s.round, sides: s.sides, bumps: s.bumps, depth: s.depth, wobble: s.wobble, seed: s.seed, tail: t?.kind ?? "point", tailW: t ? Math.round((t.width / minSide(box)) * 100) : 22, bend: Math.round(t?.bend ?? 28), shift: Math.round((t?.shift ?? 0) * DEG), belly: Math.round(t?.belly ?? 50), base: t?.follow ? "follows" : "locked", baseAt: t ? Math.round(tailAngle(box, t) * DEG) : 0 };
}

/** Only what was changed goes onto each selected balloon. */
function applied(p: Readonly<Record<string, string | number>>, s: BalloonSpec, box: Box, ix: number): BalloonSpec {
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

const control = ([s, name]: Ctl): string => {
  const at = `data-bln="${s.k}" data-name="${esc(name)}" aria-label="${esc(name)}" title="${esc(name)}"`;
  if (s.t === "range") return `<label class="tb-count" data-bl-wrap="${s.k}">${esc(s.label)} <input type="number" ${at} min="${s.min}" max="${s.max}" step="${s.step}" inputmode="decimal"></label>`;
  if (s.t === "choice") return `<select ${at}>${s.opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  return "";
};
const group = (id: string, label: string, ctls: readonly Ctl[]): string =>
  `<div class="tb-group tb-options" data-for="shape balloon path text select node" data-bl-group="${id}" role="group" aria-label="${label}">${ctls.map(control).join("")}${BUTTONS[id]!.map(([b, name, title, icon]) => `<button type="button" data-bl="${b}" data-name="${esc(name)}" aria-label="${esc(name)}" title="${esc(title)}">${icon}</button>`).join("")}</div>`;

/** Build the groups into the Properties bar's row after `after`; `sync` (before the bar sorts its groups) fills and shows what applies. */
export function mountBalloonBar(after: HTMLElement, actions: BalloonActions): { sync(): void } {
  after.insertAdjacentHTML("afterend", group("body", "Body", BODY) + group("tail", "Tail", TAIL) + group("text", "Text in shape", TEXT) + group("link", "Connector", LINK));
  const row = after.parentElement!;
  const field = (k: string): HTMLInputElement | HTMLSelectElement => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-bln="${k}"]`)!;
  const wrap = (k: string): HTMLElement => { const f = field(k); return (f.closest<HTMLElement>("[data-bl-wrap]") ?? f); };
  const button = (id: string): HTMLButtonElement => row.querySelector<HTMLButtonElement>(`[data-bl="${id}"]`)!;
  let values: Record<string, string | number> = {};
  let pending: Record<string, string | number> = {};
  let timer = 0;
  let ix = 0;
  const lookOf = (p: Readonly<Record<string, string | number>>): TextLook => {
    // (the four together: a side that was never set follows another, and must not change when that one does)
    const anyPad = ["padX", "padR", "padY", "padB"].some((k) => p[k] !== undefined);
    const opts = { ...(anyPad ? { padX: values["padX"] as number, padR: values["padR"] as number, padY: values["padY"] as number, padB: values["padB"] as number } : {}), ...(p["over"] !== undefined ? { hide: p["over"] === "hide" } : {}) };
    return { ...(p["across"] !== undefined ? { align: p["across"] as "left" } : {}), ...(p["down"] !== undefined ? { valign: p["down"] as "top" } : {}), ...(Object.keys(opts).length ? { shapeOpts: opts } : {}) };
  };
  const send = (p: Record<string, string | number>, final: boolean): void => {
    const shape: Record<string, string | number> = {}, text: Record<string, string | number> = {}, link: Record<string, string | number> = {};
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
  const put = (changes: Record<string, string | number>): void => {
    Object.assign(values, changes);
    Object.assign(pending, changes);
    send({ ...pending }, false);
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 200); // (a drag along a number is one undo step)
    showWhich();
  };
  /** Which groups apply to what is selected (set by `sync`). */
  let on: Record<string, boolean> = { body: false, tail: false, text: false, link: false };
  let tails = 0;
  const groupOf = (k: string): string => (TEXT_KEYS.has(k) ? "text" : LINK_KEYS.has(k) ? "link" : BODY.some(([b]) => b.k === k) ? "body" : "tail");
  /** Show the controls that apply: their group is what is selected, and a choice decides some (the body's kind, the tail's kind, its base). */
  const showWhich = (): void => {
    for (const [s] of ALL) {
      const cond = s.when ? s.when.slice(1).includes(String(values[s.when[0]!])) : true;
      wrap(s.k).hidden = !on[groupOf(s.k)] || !cond || (s.k === "which" && tails < 2);
    }
  };
  for (const [s] of ALL) {
    const f = field(s.k);
    if (s.t === "range") {
      f.addEventListener("input", () => {
        const v = Number(f.value);
        if (f.value !== "" && Number.isFinite(v)) put({ [s.k]: v });
      });
      f.addEventListener("change", flush);
    } else f.addEventListener("change", () => {
      if (s.k === "which") {
        flush();
        ix = Number(f.value);
        sync(true);
        return;
      }
      if (s.k === "preset") {
        const p = BALLOON_PRESETS.find(([id]) => id === f.value);
        if (p) put({ body: p[2], tail: p[3] });
        flush();
        f.value = "";
        sync(true);
        return;
      }
      put({ [s.k]: f.value });
      flush();
    });
  }
  row.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-bl]")?.dataset["bl"];
    if (!id) return;
    flush();
    if (id === "addtail") actions.change((s, box) => withNewTail(box, s), true);
    else if (id === "deltail") { const at = ix; actions.change((s) => ({ ...s, tails: s.tails.filter((_, i) => i !== at) }), true); }
    else if (id === "fit") actions.setText({ fitShape: true }, true);
    else if (id === "connect") actions.connect();
    else if (id === "topath") actions.toPath();
    else if (id === "save") actions.saveStyle();
  });
  /** Fill the controls from what is selected and show those that apply (`force`: also the fields being typed in). */
  const sync = (force = false): void => {
    const cur = actions.selected(), text = actions.text(), link = actions.link();
    if (timer && !force) return; // (a change on its way: the bar shows it already)
    tails = cur?.spec.tails.length ?? 0;
    ix = cur ? Math.max(0, Math.min(ix, tails - 1)) : 0;
    values = {
      ...(cur ? shown(cur.box, cur.spec, ix) : {}),
      ...(text ? { across: text.align, down: text.valign, padX: text.padX, padR: text.padR, padY: text.padY, padB: text.padB, over: text.hide ? "hide" : "show" } : {}),
      ...(link ? { linkStyle: link.style, linkW: link.width, linkBend: link.bend } : {}),
    };
    // (the choice of tail: one per tail of the balloon)
    const which = field("which") as HTMLSelectElement;
    const opts = Array.from({ length: Math.max(1, tails) }, (_, i) => `<option value="${i}">Tail ${i + 1}</option>`).join("");
    if (which.dataset["html"] !== opts) { which.dataset["html"] = opts; which.innerHTML = opts; }
    on = { body: !!cur, tail: !!cur && tails > 0, text: !!text, link: !!link };
    showWhich();
    for (const [s] of ALL) {
      const f = field(s.k);
      if (values[s.k] !== undefined && (force || document.activeElement !== f)) {
        const v = String(values[s.k]);
        if (f.value !== v) f.value = v;
      }
    }
    button("addtail").hidden = !cur; // (a balloon with no tail yet: its Tail chip offers one)
    button("deltail").hidden = !tails;
    button("fit").hidden = !text;
    button("fit").title = text?.overflow ? "Some of the text does not fit: the biggest size at which all of it fits" : "The biggest size at which all the text fits";
    button("connect").hidden = !actions.canConnect();
    button("topath").hidden = button("save").hidden = !cur;
  };
  return { sync: () => sync() };
}
