import { scrubNumbers } from "../colour-picker/scrub";
import type { Section, Setting } from "../gen/types";
import { openColourPopover } from "./colour-popover";
import { esc } from "./format";
import { ICONS } from "./icons";
import { liveNumber } from "./live";

/** The most choices a row shows as buttons. */
const MOST_BUTTONS = 4;

/** One setting's value. */
export type SettingValue = number | string | boolean;

/**
 * The rows of settings of a panel, whatever they set (a pattern's, a 3D view's): a range and its number, a tick, a choice or a colour. `extra` goes beside
 * its name (a lock). Double-click on the name or the range: its usual value.
 */
export function settingRowHtml(s: Setting, v: SettingValue, extra = "", /** Unique among the panels that can be open together. */ idPrefix = "pg-n-"): string {
  if (s.t === "range") return `<div class="adj-row" data-k="${s.k}"><label class="adj-label" for="${idPrefix}${s.k}">${esc(s.label)}${extra}</label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)}"><input type="number" class="adj-num" id="${idPrefix}${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)} value"></div>`;
  if (s.t === "toggle") return `<div class="adj-row pg-line" data-k="${s.k}"><label class="pg-check"><input type="checkbox"${v ? " checked" : ""}> <span>${esc(s.label)}</span>${extra}</label></div>`;
  // (more than a few: a dropdown, one line, however many there are)
  if (s.t === "choice" && (s.opts.length > MOST_BUTTONS || s.dropdown)) return `<div class="adj-row" data-k="${s.k}"><span class="adj-label">${esc(s.label)}${extra}</span><select data-choice aria-label="${esc(s.label)}">${s.opts.map(([o, l]) => `<option value="${o}"${o === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  if (s.t === "choice") return `<div class="adj-row pg-line" data-k="${s.k}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="adj-layers pg-seg" role="group" aria-label="${esc(s.label)}">${s.opts.map(([o, l]) => `<button type="button" data-v="${o}" aria-pressed="${o === v}">${esc(l)}</button>`).join("")}</div></div>`;
  const none = v === "";
  return `<div class="adj-row pg-line" data-k="${s.k}"><span class="adj-label">${esc(s.label)}${extra}</span><div class="pg-colour"><button type="button" class="pg-swatch" data-swatch aria-label="${esc(s.label)} colour"></button><code>${none ? "none" : String(v).toUpperCase()}</code>${s.hide ? `<button type="button" class="pg-eye" data-eye aria-pressed="${!none}" aria-label="Show ${esc(s.label)}" title="${none ? "Show" : "Hide"} ${esc(s.label.toLowerCase())}">${none ? ICONS.eyeOff : ICONS.eye}</button>` : ""}</div></div>`;
}

/** Makes a row work. `get` reads a value now, `set` changes it; `reset` is its double-click. */
export function bindSettingRow(r: HTMLElement, s: Setting, get: (k: string) => SettingValue, set: (k: string, v: SettingValue) => void, reset: () => void): void {
  r.querySelector(".adj-label, .pg-check")?.setAttribute("title", `${s.tip ? `${s.tip} ` : ""}Double-click to reset`);
  r.addEventListener("dblclick", (e) => {
    const on = e.target as HTMLElement;
    if (on.closest("[data-lock]") || !on.closest(".adj-label, .pg-check, input[type=range]")) return;
    reset();
  });
  if (s.t === "range") {
    const range = r.querySelector<HTMLInputElement>("input[type=range]")!, num = r.querySelector<HTMLInputElement>("input[type=number]")!;
    range.addEventListener("input", () => { num.value = range.value; set(s.k, Number(range.value)); });
    liveNumber(num, (x) => { range.value = String(x); set(s.k, Math.min(s.max, Math.max(s.min, x))); });
  } else if (s.t === "toggle") r.querySelector("input")!.addEventListener("change", (e) => set(s.k, (e.target as HTMLInputElement).checked));
  else if (s.t === "choice" && r.querySelector("select")) r.querySelector("select")!.addEventListener("change", (e) => set(s.k, (e.target as HTMLSelectElement).value));
  else if (s.t === "choice") r.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-v]");
    if (!b) return;
    for (const o of r.querySelectorAll("[data-v]")) o.setAttribute("aria-pressed", String(o === b));
    set(s.k, b.dataset["v"]!);
  });
  else {
    const sw = r.querySelector<HTMLElement>("[data-swatch]")!, code = r.querySelector("code")!;
    let last = (get(s.k) as string) || s.shown || s.def;
    const paint = (): void => {
      const c = get(s.k) as string;
      sw.style.background = c || last;
      sw.classList.toggle("is-none", c === "");
      code.textContent = c ? c.toUpperCase() : "none";
      const eye = r.querySelector<HTMLElement>("[data-eye]");
      if (eye) { eye.setAttribute("aria-pressed", String(c !== "")); eye.innerHTML = c ? ICONS.eye : ICONS.eyeOff; }
    };
    paint();
    sw.addEventListener("click", () => openColourPopover(sw, { name: s.label, value: last, onInput: (h) => { last = h.slice(0, 7); set(s.k, last); paint(); } }));
    r.querySelector("[data-eye]")?.addEventListener("click", () => { set(s.k, get(s.k) === "" ? last : ""); paint(); });
  }
}

/** The title of a group of settings, with its Reset (one look: the Adjust panel's, a pattern's and a 3D view's). */
export const groupHeadHtml = (name: string, changed: boolean): string =>
  `<div class="adj-group-head"><h4>${esc(name)}</h4><button type="button" class="layer-btn adj-reset" data-group-reset="${esc(name)}" aria-label="Reset ${esc(name.toLowerCase())}" title="Reset ${esc(name.toLowerCase())}"${changed ? "" : " disabled"}>${ICONS.listRestart}</button></div>`;

/**
 * A panel's settings in their groups: each row with its double-click and each group with its Reset, the numbers draggable. It is the whole of what a
 * panel of settings does, whatever it sets: the panel says what its values are and what a change or a reset does. Draw again with `build`.
 */
export function mountSettings(host: HTMLElement, o: {
  sections(): readonly Section[];
  get(k: string): SettingValue;
  set(k: string, v: SettingValue): void;
  /** Values back to their usual ones (several at once: one change). */
  reset(keys: readonly Setting[]): void;
  /** Beside a name (a lock). */
  extra?(s: Setting): string;
  /** After a row is made. */
  bound?(r: HTMLElement, s: Setting): void;
  idPrefix?: string;
}): { build(): void; syncResets(): void } {
  const shown = (s: Setting): boolean => !s.when || s.when.slice(1).includes(o.get(s.when[0]!) as string);
  const items = (sec: Section): readonly Setting[] => sec.items.filter(shown);
  const changed = (sec: Section): boolean => sec.items.some((s) => o.get(s.k) !== s.def);
  const syncResets = (): void => {
    for (const sec of o.sections()) {
      const b = [...host.querySelectorAll<HTMLButtonElement>("[data-group-reset]")].find((x) => x.dataset["groupReset"] === sec.title);
      if (b) b.disabled = !changed(sec);
    }
  };
  const build = (): void => {
    host.innerHTML = o.sections().map((sec) => `<div class="adj-group">${groupHeadHtml(sec.title, changed(sec))}${items(sec).map((s) => settingRowHtml(s, o.get(s.k), o.extra?.(s) ?? "", o.idPrefix)).join("")}</div>`).join("");
    const all = o.sections().flatMap((x) => x.items);
    for (const r of host.querySelectorAll<HTMLElement>("[data-k]")) {
      const s = all.find((x) => x.k === r.dataset["k"])!;
      o.bound?.(r, s);
      bindSettingRow(r, s, o.get, (k, v) => {
        o.set(k, v);
        syncResets();
      }, () => {
        o.reset([s]);
        build();
      });
    }
  };
  host.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-group-reset]");
    const sec = b && o.sections().find((x) => x.title === b.dataset["groupReset"]);
    if (!sec) return;
    o.reset(sec.items);
    build();
  });
  if (!host.closest("[data-scrub-root]")) scrubNumbers(host); // (drag a number to change it, as everywhere; rows made again later are marked on the first pointer over)
  return { build, syncResets };
}
