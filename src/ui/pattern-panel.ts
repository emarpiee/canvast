import type { EditorState } from "../app/editor-state";
import { GENERATORS, cleanValues, defaultValues, generate, generatorById, makeRng, randomValues, sectionsOf } from "../gen";
import type { Generator, Setting, Values } from "../gen";
import { thumbSvg } from "./pattern-thumb";
import { esc } from "./format";
import { ICONS } from "./icons";
import { scrubNumbers } from "../colour-picker/scrub";
import { panelHtml } from "./panel";
import { settingRow, wireSettingRow } from "./setting-rows";

/**
 * The Pattern panel (ADR 0162): pick a generator (a grid of small pictures), change the settings it declares, make it on the picked sheet or
 * shape (or a new sheet). The panel is built from the generator's settings, so every generator has its own controls. Once a result is made,
 * each change replaces it (one undo step for the whole session) until Done. Picking a pattern made earlier loads its settings, and changes
 * replace it where it is. A snowflake on a setting keeps it when Randomize runs.
 */
export interface PatternActions {
  /** Make the result on the target (replacing the session's last one). False when it could not be made. */
  make(g: Generator, values: Values, seed: number): boolean;
  /** Whether a change can replace what is on the canvas now (the session's last result, or a picked pattern). */
  live(): boolean;
  /** The picked pattern made by a generator, with its settings. */
  found(): { id: string; gid: string; seed: number; v: Values } | null;
  /** End the session: the next result is a new one. */
  end(): void;
  /** What a result would go on, in words. */
  target(): string;
  /** Whether a result would go on something picked (a sheet or a shape), not on a new sheet. */
  hasTarget(): boolean;
  /** Keep the generator, its settings and the seed as a style (Styles panel). */
  saveStyle(g: Generator, values: Values, seed: number): void;
}

/** What the Pattern panel can be handed: a saved pattern style is put into it (and made at once when something is picked to put it on). */
export interface PatternHandle {
  use(id: string, values: Values, seed: number): void;
  /** The generator, settings and seed in the panel now. */
  current(): { id: string; v: Values; seed: number };
}

const SEED_MAX = 999_999;
const newSeed = (): number => 1 + Math.floor(Math.random() * SEED_MAX);

export function mountPatternPanel(host: HTMLElement, editor: EditorState, actions: PatternActions): PatternHandle {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel pattern-panel";
  panel.setAttribute("aria-label", "Pattern");
  panel.dataset["testid"] = "pattern-panel";
  panel.hidden = true;
  const families = [...new Set(GENERATORS.map((g) => g.family))];
  panel.innerHTML = panelHtml({
    title: "Pattern",
    tools: `<button type="button" class="layer-btn" data-pg-reset aria-label="Reset the settings" title="Reset the settings of this generator">${ICONS.listRestart}</button>`,
    sub: `<div class="pg-pick">
      <button type="button" class="pg-current" data-pg-pick aria-expanded="false" aria-label="Generator"><span class="pg-thumb" data-pg-cur></span><span class="pg-name" data-pg-name></span>${ICONS.chevronDown}</button>
      <div class="pg-grid" data-pg-grid hidden>${families.map((f) => `<h5>${f}</h5><div class="pg-tiles">${GENERATORS.filter((g) => g.family === f).map((g) => `<button type="button" class="pg-tile" data-gen="${g.id}" aria-label="${esc(g.label)}: ${esc(g.about)}" title="${esc(g.about)}"><span class="pg-thumb"></span><span>${esc(g.label)}</span></button>`).join("")}</div>`).join("")}</div>
      <p class="adj-note" data-pg-about></p>
      <p class="adj-note">On: <b data-pg-target></b></p>
    </div>`,
    body: `<div data-pg-body></div>`,
    foot: `<div class="adj-foot pg-foot">
      <div class="pg-seed"><label>Seed <input type="number" class="adj-num" min="1" max="${SEED_MAX}" step="1" data-pg-seed aria-label="Seed"></label><button type="button" data-pg-newseed aria-label="New seed" title="New seed: keep the settings and try another arrangement">${ICONS.shuffle}</button></div>
      <div class="pg-actions"><button type="button" data-pg-random aria-label="Randomize" title="Randomize: random settings and a new seed; settings marked with a snowflake stay">${ICONS.dice5}</button><button type="button" class="is-primary" data-pg-make data-testid="pattern-make" aria-label="Generate" title="Generate the pattern">${ICONS.sparkles}</button><button type="button" data-pg-style aria-label="Save as a style" title="Save as a style: keep this generator, its settings and seed in the Styles panel">${ICONS.save}</button><button type="button" data-pg-done aria-label="Done" title="Done: keep the result and start a new one next time">${ICONS.check}</button></div>
    </div>`,
  });
  host.appendChild(panel);
  scrubNumbers(panel); // (drag a number to change it, as everywhere; the rows are built again for each generator, and are marked on the first pointer over)
  const q = <T extends HTMLElement>(s: string): T => panel.querySelector<T>(s)!;
  const body = q("[data-pg-body]"), grid = q("[data-pg-grid]"), pick = q("[data-pg-pick]"), seedBox = q<HTMLInputElement>("[data-pg-seed]");

  let gen: Generator = GENERATORS[0]!;
  const kept = new Map<string, Values>();
  const frozen = new Map<string, Set<string>>(); // the settings kept when Randomize runs, for each generator
  let values: Values = defaultValues(gen);
  let seed = newSeed();
  let started = false; // a result of this session is on the canvas, or a pattern is picked: changes replace it
  let loaded: string | null = null; // the group of the picked pattern whose settings are in the panel

  const run = (): void => {
    started = actions.make(gen, cleanValues(gen, values), seed);
  };
  let queued = false;
  const again = (): void => {
    if (!started || !actions.live() || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (started && actions.live()) run();
    });
  };
  const set = (k: string, v: number | string | boolean): void => {
    values[k] = v;
    kept.set(gen.id, values);
    again();
  };
  const locks = (): Set<string> => frozen.get(gen.id) ?? frozen.set(gen.id, new Set()).get(gen.id)!;

  const lock = (s: Setting): string => `<button type="button" class="pg-lock" data-lock aria-pressed="${locks().has(s.k)}" aria-label="Keep ${esc(s.label)} when randomizing" title="Keep ${esc(s.label.toLowerCase())} when randomizing">${ICONS.snowflake}</button>`;
  const row = (s: Setting): string => settingRow(s, values[s.k]!, `pg-n-${s.k}`, lock(s));

  // Small pictures of the generators, made when the grid is first opened, one at a time so the panel stays responsive.
  const thumbs = new Map<string, string>();
  let thumbing = false;
  const fillThumbs = (): void => {
    if (thumbing) return;
    thumbing = true;
    const todo = GENERATORS.filter((g) => !thumbs.has(g.id));
    const step = (): void => {
      const g = todo.shift();
      if (!g) { thumbing = false; return; }
      try { thumbs.set(g.id, thumbSvg(g)); } catch { thumbs.set(g.id, ""); }
      const tile = grid.querySelector(`[data-gen="${g.id}"] .pg-thumb`);
      if (tile) tile.innerHTML = thumbs.get(g.id)!;
      if (gen.id === g.id) q("[data-pg-cur]").innerHTML = thumbs.get(g.id)!;
      setTimeout(step);
    };
    step();
  };

  const build = (): void => {
    for (const t of grid.querySelectorAll("[data-gen]")) t.setAttribute("aria-pressed", String(t.getAttribute("data-gen") === gen.id));
    q("[data-pg-name]").textContent = gen.label;
    q("[data-pg-cur]").innerHTML = thumbs.get(gen.id) ?? "";
    q("[data-pg-about]").textContent = gen.about;
    seedBox.value = String(seed);
    body.innerHTML = sectionsOf(gen).map((sec) => `<div class="adj-group"><h4>${esc(sec.title)}</h4>${sec.items.map(row).join("")}</div>`).join("");
    for (const r of body.querySelectorAll<HTMLElement>("[data-k]")) {
      const s = sectionsOf(gen).flatMap((x) => x.items).find((x) => x.k === r.dataset["k"])!;
      r.querySelector("[data-lock]")!.addEventListener("click", (e) => {
        const on = !locks().has(s.k);
        if (on) locks().add(s.k); else locks().delete(s.k);
        (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(on));
      });
      wireSettingRow(r, s, () => values[s.k]!, (v) => set(s.k, v));
    }
  };

  const choose = (id: string): void => {
    gen = generatorById(id) ?? gen;
    values = kept.get(gen.id) ?? defaultValues(gen);
    build();
    again();
  };

  const render = (): void => {
    if (panel.hidden !== !editor.patternOpen) {
      panel.hidden = !editor.patternOpen;
      if (panel.hidden) {
        actions.end();
        started = false;
        loaded = null;
      } else fillThumbs();
    }
    if (panel.hidden) return;
    const f = actions.found();
    if (!f) loaded = null;
    else if (f.gid !== loaded && generatorById(f.id)) { // a pattern made earlier is picked: its settings come into the panel, and changes replace it
      loaded = f.gid;
      gen = generatorById(f.id)!;
      values = cleanValues(gen, f.v);
      kept.set(gen.id, values);
      seed = f.seed;
      build();
      started = true;
    }
    if (started && !actions.live()) started = false; // (undone, or something else was done since: the next change does not replace anything)
    q("[data-pg-target]").textContent = actions.target();
    q("[data-pg-done]").toggleAttribute("disabled", !started);
  };
  let scheduled = false;
  editor.subscribe(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; render(); });
    }
  });
  build();
  render();

  seedBox.addEventListener("change", () => {
    const x = Math.round(Number(seedBox.value));
    seed = Number.isFinite(x) ? Math.min(SEED_MAX, Math.max(1, x)) : seed;
    seedBox.value = String(seed);
    again();
  });
  panel.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!t) return;
    if (t.hasAttribute("data-close")) { editor.patternOpen = false; editor.changed(); }
    else if (t.hasAttribute("data-pg-pick")) { grid.hidden = !grid.hidden; pick.setAttribute("aria-expanded", String(!grid.hidden)); }
    else if (t.hasAttribute("data-gen")) { grid.hidden = true; pick.setAttribute("aria-expanded", "false"); choose(t.dataset["gen"]!); }
    else if (t.hasAttribute("data-pg-make")) run();
    else if (t.hasAttribute("data-pg-style")) actions.saveStyle(gen, cleanValues(gen, values), seed);
    else if (t.hasAttribute("data-pg-done")) { actions.end(); started = false; seed = newSeed(); build(); editor.changed(); }
    else if (t.hasAttribute("data-pg-newseed")) {
      const before = seed;
      seed = newSeed();
      seedBox.value = String(seed);
      again();
      // a pattern that is exact at these settings looks the same with any seed: say so, and where to change it
      if (JSON.stringify(generate(gen, values, before, 900, 600)) === JSON.stringify(generate(gen, values, seed, 900, 600))) {
        editor.message = `The seed changes nothing in ${gen.label} at these settings.${gen.sections.some((x) => x.items.some((i) => i.k === "jitter")) ? " Raise Looseness to let it." : ""}`;
        editor.changed();
      }
    }
    else if (t.hasAttribute("data-pg-random")) {
      seed = newSeed();
      const r = randomValues(gen, makeRng(seed));
      for (const k of locks()) if (k in values) r[k] = values[k]!; // (what is marked with a snowflake stays)
      values = r;
      kept.set(gen.id, values);
      build();
      run();
    }
    else if (t.hasAttribute("data-pg-reset")) { values = defaultValues(gen); kept.set(gen.id, values); build(); again(); }
  });
  panel.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches("input, select, textarea")) e.stopPropagation();
  });
  return {
    current: () => ({ id: gen.id, v: cleanValues(gen, values), seed }),
    use(id, v, s) {
      const g = generatorById(id);
      if (!g) return;
      gen = g;
      values = cleanValues(g, v);
      kept.set(g.id, values);
      seed = s;
      started = false; // (a style is a new result, not a change of the last one)
      build();
      if (actions.hasTarget()) run();
    },
  };
}
