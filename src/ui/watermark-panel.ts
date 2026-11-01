import type { EditorState } from "../app/editor-state";
import type { Watermark } from "../doc/watermark";
import { LOGO_MAX_PX, MAX_WATERMARK_TEXT, newWatermark, textMetrics } from "../doc/watermark";
import { plural } from "../doc/plural";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";
import { esc } from "./format";
import type { HideOptions, HideResult, MarkMethod, ReadResult } from "../app/invisible-mark-actions";
import { MAX_LSB_TEXT } from "../doc/lsb-mark";
import { logoFromFile, logoPicture } from "../app/invisible-mark-actions";
import { MAX_MARK_TEXT_BYTES } from "../doc/invisible-mark";
import type { Strength } from "../doc/invisible-mark";

/**
 * The Watermark panel: a visible watermark (a text or a small picture) on the selected pictures, placed freely on the canvas with its own
 * handles, kept editable on the picture or made part of it. A panel of the dock, like Adjust; the toolbar's Watermark button shows it.
 */
export interface WatermarkPanelActions {
  selectedWatermark(): { wm: Watermark | null; count: number; id: string } | null;
  previewWatermark(wm: Watermark): void;
  commitWatermark(wm: Watermark | null, label: string): void;
  makePermanent(): void;
  /** What an invisible watermark would go in: the one picked picture (a still), the one picked text, or nothing. */
  markTarget(): "picture" | "text" | null;
  hideInPicture(opts: HideOptions): Promise<HideResult>;
  hideInText(words: string, password: string): Promise<boolean>;
  /** Read the picked picture or text. */
  readSelected(password: string, progress: (done: number, total: number) => void): Promise<ReadResult>;
  readFile(file: File, password: string, progress: (done: number, total: number) => void): Promise<ReadResult>;
  readPasted(text: string, password: string): Promise<ReadResult>;
}

type Tab = "visible" | "invisible" | "read";
const TABS: ReadonlyArray<[Tab, string, string]> = [
  ["visible", "Visible", "A text or a picture over the picture, that is seen"],
  ["invisible", "Invisible", "Hide a text or a logo in a picture's pixels, or between a text's words: it is not seen, and can be read back"],
  ["read", "Read", "Read an invisible watermark in a picture, a text or a file"],
];

/** A picture file as a PNG data URL no bigger than `LOGO_MAX_PX` on its longer side (null: not a picture the browser can read). */
async function logoOf(file: Blob): Promise<{ src: string; w: number; h: number } | null> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, LOGO_MAX_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}

export function mountWatermarkPanel(host: HTMLElement, editor: EditorState, actions: WatermarkPanelActions): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel adjust-panel watermark-panel";
  panel.setAttribute("aria-label", "Watermark");
  panel.dataset["testid"] = "watermark-panel";
  panel.hidden = true;
  panel.innerHTML = panelHtml({
    title: "Watermark",
    sub: `<div class="styles-tabs" role="tablist" aria-label="Kinds of watermark">${TABS.map(([id, label, hint]) => `<button type="button" role="tab" class="styles-tab" data-wm-tab="${id}" aria-selected="${id === "visible"}" title="${hint}">${label}</button>`).join("")}</div>`,
    body: `<div class="adjust-body" data-wm-body></div>`,
  });
  host.appendChild(panel);
  const body = panel.querySelector<HTMLElement>("[data-wm-body]")!;
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  file.dataset["testid"] = "watermark-logo-input";
  panel.appendChild(file);
  const readFile = document.createElement("input");
  readFile.type = "file";
  readFile.accept = "image/*";
  readFile.hidden = true;
  readFile.dataset["testid"] = "watermark-read-input";
  panel.appendChild(readFile);
  const markLogo = document.createElement("input");
  markLogo.type = "file";
  markLogo.accept = "image/*";
  markLogo.hidden = true;
  markLogo.dataset["testid"] = "watermark-mark-logo-input";
  panel.appendChild(markLogo);
  let shownKey = "";
  let scheduled = false;
  let tab: Tab = "visible";
  /** What the Invisible tab holds while it is filled in (kept when the tab or the selection changes). */
  const mark = { method: "blocks" as MarkMethod, kind: "text" as "text" | "logo", text: "", long: "", logo: null as { bits: Uint8Array; preview: string } | null, password: "", strength: "normal" as Strength, part: false, busy: false, result: "" };
  const reading = { password: "", busy: false, result: "" };

  const row = (label: string, name: string, min: number, max: number, step: number, unit: string): string =>
    `<label class="adj-row"><span class="adj-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-wm-range="${name}" aria-label="${label} (${unit})"><input type="number" class="adj-num" min="${min}" max="${max}" step="${step}" data-wm-num="${name}" aria-label="${label} (${unit})"></label>`;

  /** The number a control shows for a watermark. */
  const valueOf = (wm: Watermark, name: string): number =>
    name === "opacity" ? Math.round(wm.opacity * 100) : name === "size" ? Math.round(wm.size * 1000) / 10 : name === "turn" ? Math.round(wm.turn) : name === "x" ? Math.round(wm.x * 1000) / 10 : Math.round(wm.y * 1000) / 10;
  const withValue = (wm: Watermark, name: string, v: number): Watermark =>
    name === "opacity" ? { ...wm, opacity: Math.min(1, Math.max(0.05, v / 100)) } : name === "size" ? { ...wm, size: Math.max(0.01, v / 100) } : name === "turn" ? { ...wm, turn: Math.max(-180, Math.min(180, v)) } : name === "x" ? { ...wm, x: v / 100 } : { ...wm, y: v / 100 };

  const render = (): void => {
    scheduled = false;
    if (panel.hidden !== !editor.watermarkOpen) panel.hidden = !editor.watermarkOpen;
    if (panel.hidden) return;
    for (const b of panel.querySelectorAll<HTMLElement>("[data-wm-tab]")) b.setAttribute("aria-selected", String(b.dataset["wmTab"] === tab));
    if (tab === "invisible") return renderInvisible();
    if (tab === "read") return renderRead();
    const sel = actions.selectedWatermark();
    const wm = sel?.wm ?? null;
    const key = !sel ? "none" : `${[...editor.selection].sort().join(",")}|${wm ? (wm.logo ? "logo" : "text") : "-"}|${sel.count}`;
    if (key !== shownKey) {
      shownKey = key;
      body.innerHTML = !sel
        ? `<p class="adj-empty">Select a picture to put a watermark on it: a text or a small picture, anywhere on it, see-through.</p>`
        : !wm
          ? `<p class="adj-note">${sel.count > 1 ? `The same watermark goes on the ${plural(sel.count, "selected picture")}, at the same place on each.` : "A text or a small picture (a logo) over the picture: you place it, size it and turn it on the canvas."}</p>
             <div class="wm-actions"><button type="button" class="styles-make" data-wm-add="text">${ICONS.watermarkText}<span>Add a text</span></button><button type="button" class="styles-make" data-wm-add="logo">${ICONS.watermarkFile}<span>Add a picture…</span></button></div>`
          : `${wm.text !== undefined
              ? `<label class="wm-text"><span class="adj-label">Text</span><textarea rows="2" maxlength="${MAX_WATERMARK_TEXT}" data-wm-text aria-label="Watermark text"></textarea></label>
                 <div class="wm-line"><label class="wm-colour"><span class="adj-label">Colour</span><input type="color" data-wm-colour aria-label="Watermark colour"></label><label class="wm-check"><input type="checkbox" data-wm-bold> Bold</label></div>`
              : `<div class="wm-line"><img class="wm-logo" data-wm-logo alt="The watermark picture"><button type="button" class="styles-make" data-wm-add="logo">${ICONS.watermarkFile}<span>Replace…</span></button></div>`}
             ${row("Opacity", "opacity", 5, 100, 1, "%")}${row("Size", "size", 1, 200, 0.5, "% of the width")}${row("Turn", "turn", -180, 180, 1, "degrees")}${row("Across", "x", 0, 100, 0.5, "% from the left")}${row("Down", "y", 0, 100, 0.5, "% from the top")}
             ${sel.count > 1 ? `<p class="adj-note">On the ${plural(sel.count, "selected picture")}, at the same place on each.</p>` : ""}
             <div class="wm-actions">
               <button type="button" class="styles-make" data-wm-place aria-pressed="false" title="Place it on the canvas: drag it, size it by a corner, turn it by the round handle">${ICONS.watermarkPlace}<span>Place on the picture</span></button>
               <button type="button" class="styles-make" data-wm-permanent title="Make it part of the picture: a new file in the library with the watermark in it, shown in place of this one (the original file is kept)">${ICONS.watermarkBake}<span>Make permanent</span></button>
               <button type="button" class="styles-make" data-wm-remove title="Take the watermark off">${ICONS.trash}<span>Remove</span></button>
             </div>`;
    }
    if (!wm) return;
    // Values follow the stored watermark (moved on the canvas, undone), except in the field being typed in.
    const set = (el: HTMLInputElement | HTMLTextAreaElement | null, v: string): void => {
      if (el && document.activeElement !== el && el.value !== v) el.value = v;
    };
    set(panel.querySelector("[data-wm-text]"), wm.text ?? "");
    set(panel.querySelector("[data-wm-colour]"), (wm.color ?? "#ffffff").slice(0, 7));
    const bold = panel.querySelector<HTMLInputElement>("[data-wm-bold]");
    if (bold) bold.checked = !!wm.bold;
    const img = panel.querySelector<HTMLImageElement>("[data-wm-logo]");
    if (img && wm.logo && img.src !== wm.logo.src) img.src = wm.logo.src;
    for (const name of ["opacity", "size", "turn", "x", "y"]) {
      set(panel.querySelector(`[data-wm-range="${name}"]`), String(valueOf(wm, name)));
      set(panel.querySelector(`[data-wm-num="${name}"]`), String(valueOf(wm, name)));
    }
    panel.querySelector("[data-wm-place]")?.setAttribute("aria-pressed", String(editor.watermarkId === sel!.id));
  };
  /** The bytes a text takes (the limit of a mark is in bytes: a letter outside English may take two or more). */
  const bytes = (t: string): number => new TextEncoder().encode(t).length;

  /** Each way of hiding it in a picture: its name, and what it holds and survives (shown under the choice). */
  const METHODS: ReadonlyArray<[MarkMethod, string, string]> = [
    ["blocks", "Sturdy", `A text of up to ${MAX_MARK_TEXT_BYTES} bytes or a logo. Survives JPEG, cropping, resizing and quarter turns.`],
    ["fourier", "Any angle", `Like Sturdy, with a faint Fourier pattern added over the whole picture that lets a copy turned by any angle or resized to any size be read.`],
    ["lsb", "LSB", "A long text that other LSB tools can read too. Lost if the picture is saved as JPEG, resized or edited (it is kept as PNG)."],
  ];
  const STRENGTHS: Record<Strength, string> = { light: "Light: hardest to see", normal: "Normal", strong: "Strong: lasts the most" };

  const renderInvisible = (): void => {
    const target = actions.markTarget();
    const picture = target === "picture";
    const m = picture ? mark.method : "text";
    const key = `invisible|${target}|${m}|${mark.kind}|${mark.busy}|${mark.result}|${!!mark.logo}|${mark.part}`;
    if (key !== shownKey) {
      shownKey = key;
      const field = (label: string, input: string): string => `<label class="wm-text"><span class="adj-label">${label}</span>${input}</label>`;
      const password = field("Password (optional)", `<input type="password" class="adj-num wm-field" data-im-pass autocomplete="new-password" aria-label="Password (optional)" placeholder="${m === "lsb" ? "None: any LSB tool shows the text" : "None: anyone with canvast can read it"}">`);
      const strength = `<label class="adj-row"><span class="adj-label">Strength</span><select class="wm-field" data-im-strength aria-label="Strength">${(Object.keys(STRENGTHS) as Strength[]).map((k) => `<option value="${k}"${k === mark.strength ? " selected" : ""}>${STRENGTHS[k]}</option>`).join("")}</select></label>`;
      // Only the fields the chosen way uses.
      const fields =
        m === "text"
          ? field(`Text <span data-im-count></span>`, `<input type="text" class="adj-num wm-field" data-im-text aria-label="Text to hide (at most ${MAX_MARK_TEXT_BYTES} bytes)" placeholder="© Your name 2026">`) + password
          : m === "lsb"
              ? field(`Text <span data-im-count></span>`, `<textarea rows="3" class="wm-field" data-im-long maxlength="${MAX_LSB_TEXT}" aria-label="Text to hide"></textarea>`) + password
              : `<div class="styles-target" role="radiogroup" aria-label="What to hide"><span>Hide</span><button type="button" role="radio" data-im-kind="text" aria-checked="${mark.kind === "text"}">A text</button><button type="button" role="radio" data-im-kind="logo" aria-checked="${mark.kind === "logo"}">A logo</button></div>
                 ${mark.kind === "text"
                   ? field(`Text <span data-im-count></span>`, `<input type="text" class="adj-num wm-field" data-im-text aria-label="Text to hide (at most ${MAX_MARK_TEXT_BYTES} bytes)" placeholder="© Your name 2026">`)
                   : `<div class="wm-line">${mark.logo ? `<img class="wm-logo wm-bits" src="${mark.logo.preview}" alt="The logo to hide, 32 by 32 dots">` : ""}<button type="button" class="styles-make" data-im-logo>${ICONS.watermarkFile}<span>${mark.logo ? "Another picture…" : "Choose a picture…"}</span></button></div>`}
                 ${strength}${password}
                 ${m === "blocks" ? `<label class="wm-check"><input type="checkbox" data-im-part${mark.part ? " checked" : ""}> Only a part of the picture (drag it on the canvas)</label>` : ""}`;
      body.innerHTML = !target
        ? `<p class="adj-empty">Select one picture or one text. A picture gets a copy beside it with the mark in its pixels; a text gets the mark between its words. Neither is seen.</p>`
        : `${picture
            ? `<div class="styles-target" role="radiogroup" aria-label="How to hide it">${METHODS.map(([id, label]) => `<button type="button" role="radio" data-im-method="${id}" aria-checked="${id === mark.method}">${label}</button>`).join("")}</div>
               <p class="adj-note">${METHODS.find(([id]) => id === mark.method)![2]} A copy beside the picture gets it; this one is not changed.</p>`
            : `<p class="adj-note">Hidden between the words as characters that are not seen. It goes with the text when it is copied, unless the app it is pasted into takes them out.</p>`}
           ${fields}
           <div class="wm-actions"><button type="button" class="styles-make" data-im-hide${mark.busy ? " disabled" : ""}>${ICONS.watermarkHide}<span>${mark.busy ? "Hiding…" : picture ? "Make a marked copy" : "Hide it in the text"}</span></button></div>
           <div class="wm-result" data-testid="watermark-hide-result" role="status">${mark.result}</div>`;
    }
    const set = (sel: string, v: string): void => {
      const el = panel.querySelector<HTMLInputElement>(sel);
      if (el && document.activeElement !== el && el.value !== v) el.value = v;
    };
    set("[data-im-text]", mark.text);
    set("[data-im-long]", mark.long);
    set("[data-im-pass]", mark.password);
    showCount();
    // The part of the picture: shown on the canvas while this tab is open, the sturdy way chosen and a part asked for.
    const sel = picture ? actions.selectedWatermark() : null;
    const want = mark.part && m === "blocks" && sel ? sel.id : null;
    if (editor.markAreaFor !== want) {
      editor.markAreaFor = want;
      editor.markArea = want ? (editor.markArea ?? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }) : null;
      editor.changed();
    }
  };

  /** How much of the field's room the typed text takes. */
  const showCount = (): void => {
    const count = panel.querySelector<HTMLElement>("[data-im-count]");
    if (!count) return;
    count.textContent = panel.querySelector("[data-im-long]") ? `${mark.long.length.toLocaleString()} / ${MAX_LSB_TEXT.toLocaleString()}` : `${bytes(mark.text)} / ${MAX_MARK_TEXT_BYTES} bytes`;
  };

  const shownResult = (r: ReadResult): string =>
    r.found === "no"
      ? `<p class="adj-note">No watermark found. (A copy turned by an angle other than a quarter turn, or made much smaller, may have lost it.)</p>`
      : r.found === "locked"
        ? `<p class="adj-note">A watermark is here, but it needs its password. Type it above and read again.</p>`
        : `<p class="adj-note">Found${r.how ? ` (${esc(r.how)})` : ""}${r.agree < 1 ? `: ${Math.round(r.agree * 100)}% of its blocks agree` : ""}.</p>${r.content.kind === "text" ? `<p class="wm-found" data-testid="watermark-found">${esc(r.content.text)}</p>` : `<img class="wm-logo wm-bits" data-testid="watermark-found-logo" src="${logoPicture(r.content.bits)}" alt="The hidden logo">`}`;

  const renderRead = (): void => {
    const target = actions.markTarget();
    const key = `read|${target}|${reading.busy}|${reading.result}`;
    if (key !== shownKey) {
      shownKey = key;
      body.innerHTML = `<label class="wm-text"><span class="adj-label">Password (if it has one)</span><input type="password" class="adj-num wm-field" data-rd-pass autocomplete="off" aria-label="Password to read with"></label>
        <div class="wm-actions">
          <button type="button" class="styles-make" data-rd-selected${target && !reading.busy ? "" : " disabled"}>${ICONS.watermarkRead}<span>Read the selected ${target === "text" ? "text" : "picture"}</span></button>
          <button type="button" class="styles-make" data-rd-file${reading.busy ? " disabled" : ""}>${ICONS.watermarkFile}<span>Read a file…</span></button>
        </div>
        <label class="wm-text"><span class="adj-label">Or paste a text</span><textarea rows="2" data-rd-text aria-label="Text to read a watermark in"></textarea></label>
        <div class="wm-actions"><button type="button" class="styles-make" data-rd-pasted${reading.busy ? " disabled" : ""}>${ICONS.watermarkRead}<span>Read the pasted text</span></button></div>
        <div class="wm-result" data-testid="watermark-read-result" role="status">${reading.result}</div>`;
    }
    const pass = panel.querySelector<HTMLInputElement>("[data-rd-pass]");
    if (pass && document.activeElement !== pass && pass.value !== reading.password) pass.value = reading.password;
  };

  const read = (run: (progress: (done: number, total: number) => void) => Promise<ReadResult>): void => {
    reading.busy = true;
    reading.result = `<p class="adj-note">Looking…</p>`;
    render();
    const out = panel.querySelector<HTMLElement>('[data-testid="watermark-read-result"]');
    void run((done, total) => {
      if (out && total > 1) out.innerHTML = `<p class="adj-note">Looking… ${Math.round((100 * done) / total)}%</p>`;
    })
      .then((r) => (reading.result = shownResult(r)))
      .catch(() => (reading.result = `<p class="adj-note">That could not be read.</p>`))
      .finally(() => {
        reading.busy = false;
        render();
      });
  };

  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  editor.subscribe(schedule);
  render();

  const current = (): Watermark | null => actions.selectedWatermark()?.wm ?? null;
  const withText = (wm: Watermark, text: string, bold: boolean): Watermark => {
    const m = textMetrics(text, bold);
    const { bold: _b, ...rest } = wm;
    return { ...rest, text, ...(bold ? { bold: true as const } : {}), em: m.em, ar: m.ar };
  };

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      editor.watermarkOpen = false;
      editor.watermarkId = null;
      editor.markArea = editor.markAreaFor = null;
      return editor.changed();
    }
    const tb = t.closest<HTMLElement>("[data-wm-tab]")?.dataset["wmTab"] as Tab | undefined;
    if (tb) {
      tab = tb;
      shownKey = "";
      if (tab !== "visible") editor.watermarkId = null; // (placing the visible one ends)
      if (tab !== "invisible") editor.markArea = editor.markAreaFor = null;
      return editor.changed();
    }
    const method = t.closest<HTMLElement>("[data-im-method]")?.dataset["imMethod"] as MarkMethod | undefined;
    if (method) {
      mark.method = method;
      mark.result = "";
      return render();
    }
    const kind = t.closest<HTMLElement>("[data-im-kind]")?.dataset["imKind"] as "text" | "logo" | undefined;
    if (kind) {
      mark.kind = kind;
      return render();
    }
    if (t.closest("[data-im-logo]")) return markLogo.click();
    if (t.closest("[data-im-hide]")) {
      const target = actions.markTarget();
      if (!target) return;
      const m = target === "text" ? "text" : mark.method;
      const say = (html: string): void => {
        mark.result = `<p class="adj-note">${html}</p>`;
        render();
      };
      const text = mark.text.trim(), long = mark.long;
      // (what each way needs, checked before anything is made)
      const sturdy = m === "blocks" || m === "fourier";
      if ((m === "text" || (sturdy && mark.kind === "text")) && (!text || bytes(text) > MAX_MARK_TEXT_BYTES)) return say(text ? `That is more than ${MAX_MARK_TEXT_BYTES} bytes: make it shorter.` : "Type the text to hide.");
      if (sturdy && mark.kind === "logo" && !mark.logo) return say("Choose a picture for the logo.");
      if (m === "lsb" && !long.trim()) return say("Type the text to hide.");
      mark.busy = true;
      mark.result = "";
      render();
      const done = (html: string): void => {
        mark.busy = false;
        mark.result = html;
        render();
      };
      if (m === "text") {
        void actions.hideInText(text, mark.password).then((ok) => done(ok ? `<p class="adj-note">Hidden in the text. Read it back in the Read tab, or after copying the text anywhere.</p>` : `<p class="adj-note">It could not be hidden.</p>`));
        return;
      }
      const content = mark.kind === "logo" ? { kind: "logo" as const, bits: mark.logo!.bits } : { kind: "text" as const, text };
      const opts: HideOptions =
        m === "fourier"
          ? { method: "fourier", content, password: mark.password, strength: mark.strength }
          : m === "lsb"
            ? { method: "lsb", text: long, password: mark.password }
            : { method: "blocks", content, password: mark.password, strength: mark.strength, ...(editor.markArea ? { region: { ...editor.markArea } } : {}) };
      void actions
        .hideInPicture(opts)
        .then((r) =>
          done(
            !r
              ? `<p class="adj-note">The marked copy could not be made.</p>`
              : "tooSmall" in r
                ? `<p class="adj-note">The part chosen (${r.tooSmall.w} × ${r.tooSmall.h} pixels of the picture) is too small to hold ${mark.kind === "logo" ? "a logo" : "this text"} well enough to be found: make it at least ${r.tooSmall.min} × ${r.tooSmall.min}${mark.kind === "text" ? ", or the text shorter" : ""}.</p>`
                : "tooLong" in r
                  ? `<p class="adj-note">This picture holds at most ${r.tooLong.capacity.toLocaleString()} bytes this way${mark.password ? " (a password makes the text about a third longer)" : ""}: make the text shorter.</p>`
                  : "seeThrough" in r
                    ? `<p class="adj-note">LSB needs a picture without see-through parts (their colours are not kept exactly). Use Sturdy or Any angle for this one.</p>`
                    : `<p class="adj-note">The marked copy is beside it, selected. It differs from the picture by ${r.psnr === Infinity ? "nothing" : `${r.psnr.toFixed(1)} dB PSNR (above 40 is not seen)`}. The change, 20 times stronger:</p><img class="wm-change" src="${r.change}" alt="The change made, 20 times stronger">`,
          ),
        )
        .catch(() => done(`<p class="adj-note">The marked copy could not be made.</p>`));
      return;
    }
    if (t.closest("[data-rd-selected]")) return read((progress) => actions.readSelected(reading.password, progress));
    if (t.closest("[data-rd-file]")) return readFile.click();
    if (t.closest("[data-rd-pasted]")) {
      const text = panel.querySelector<HTMLTextAreaElement>("[data-rd-text]")?.value ?? "";
      return read(() => actions.readPasted(text, reading.password));
    }
    const add = t.closest<HTMLElement>("[data-wm-add]")?.dataset["wmAdd"];
    if (add === "text") {
      actions.commitWatermark(newWatermark({ text: "© Your name", color: "#ffffff" }), "Add watermark");
      editor.watermarkId = actions.selectedWatermark()?.id ?? null; // (straight into placing it)
      return editor.changed();
    }
    if (add === "logo") return file.click();
    if (t.closest("[data-wm-place]")) {
      const id = actions.selectedWatermark()?.id ?? null;
      editor.watermarkId = editor.watermarkId === id ? null : id;
      return editor.changed();
    }
    if (t.closest("[data-wm-permanent]")) return actions.makePermanent();
    if (t.closest("[data-wm-remove]")) actions.commitWatermark(null, "Remove watermark");
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    void logoOf(f).then((logo) => {
      if (!logo) {
        editor.message = "That file is not a picture this browser can read.";
        return editor.changed();
      }
      const wm = current();
      // (a picture in place of the one there keeps its place, size, turn and opacity; in place of a text, a new one)
      actions.commitWatermark(wm?.logo ? { ...wm, logo, ar: logo.h / logo.w } : newWatermark({ logo }), wm ? "Replace watermark picture" : "Add watermark");
      editor.watermarkId = actions.selectedWatermark()?.id ?? null;
      editor.changed();
    });
  });
  readFile.addEventListener("change", () => {
    const f = readFile.files?.[0];
    readFile.value = "";
    if (f) read((progress) => actions.readFile(f, reading.password, progress));
  });
  markLogo.addEventListener("change", () => {
    const f = markLogo.files?.[0];
    markLogo.value = "";
    if (!f) return;
    void logoFromFile(f).then((logo) => {
      mark.logo = logo;
      mark.result = logo ? "" : `<p class="adj-note">That file is not a picture this browser can read.</p>`;
      render();
    });
  });
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-im-text], [data-im-long]")) {
      if (t.matches("[data-im-text]")) mark.text = t.value;
      else mark.long = t.value;
      return showCount();
    }
    if (t.matches("[data-im-pass]")) return void (mark.password = t.value);
    if (t.matches("[data-rd-pass]")) return void (reading.password = t.value);
    const wm = current();
    if (!wm) return;
    const name = t.dataset["wmRange"] ?? t.dataset["wmNum"];
    if (name && t.value !== "" && Number.isFinite(Number(t.value))) {
      const other = panel.querySelector<HTMLInputElement>(t.dataset["wmRange"] ? `[data-wm-num="${name}"]` : `[data-wm-range="${name}"]`);
      if (other) other.value = t.value;
      actions.previewWatermark(withValue(wm, name, Number(t.value)));
    } else if (t.matches("[data-wm-text]") && t.value.trim()) actions.previewWatermark(withText(wm, t.value, !!wm.bold));
    else if (t.matches("[data-wm-colour]")) actions.previewWatermark({ ...wm, color: t.value });
  });
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-im-strength]")) return void (mark.strength = t.value as Strength);
    if (t.matches("[data-im-part]")) {
      mark.part = t.checked;
      return render();
    }
    if (t.matches("[data-im-text], [data-im-long], [data-im-pass], [data-rd-pass], [data-rd-text]")) return;
    const wm = current();
    if (!wm) return;
    const name = t.dataset["wmRange"] ?? t.dataset["wmNum"];
    if (name && t.value !== "" && Number.isFinite(Number(t.value))) actions.commitWatermark(withValue(wm, name, Number(t.value)), "Change watermark");
    else if (t.matches("[data-wm-text]")) {
      if (t.value.trim()) actions.commitWatermark(withText(wm, t.value, !!wm.bold), "Change watermark text");
      else t.value = wm.text ?? ""; // (an empty text is not a watermark: Remove takes it off)
    } else if (t.matches("[data-wm-colour]")) actions.commitWatermark({ ...wm, color: t.value }, "Change watermark colour");
    else if (t.matches("[data-wm-bold]")) actions.commitWatermark(withText(wm, wm.text ?? "", t.checked), "Change watermark text");
    else shownKey = ""; // (anything else: drawn again)
    schedule();
  });
  panel.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, select, textarea")) e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
}
