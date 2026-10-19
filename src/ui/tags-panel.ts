import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import { esc } from "./format";
import { ICONS } from "./icons";
import { panelHtml } from "./panel";
import { moreButton, openMoreMenu } from "./more-menu";

/**
 * Floating Tags panel (ADR 0076): the in-canvas tags (ADR 0062) in one place, next to Layers and Bookmarks.
 *  - On the selection: the tags the selected items carry (× takes one off), a box to add more (a comma separates several), and the other
 *    tags of this canvas as one-press suggestions.
 *  - On this canvas: every tag with how many items carry it. Press a tag to select those items (Shift or Ctrl adds them to the selection);
 *    its ⋯ menu renames or deletes it on every canvas (ADR 0070).
 * Hidden by default, like the other panels.
 */
export interface TagsActions {
  /** Add or remove in-canvas tags on objects. */
  tag(ids: readonly string[], change: { add?: readonly string[]; remove?: readonly string[] }): void;
  /** Rename or delete an in-canvas tag on every canvas of the workspace (ADR 0070); delete asks first. */
  renameTag(from: string, to: string): void;
  deleteTag(tag: string): void;
}

const SUGGESTIONS = 8;
/** Show the filter box when there are more tags than this. */
const FILTER_FROM = 8;

export function mountTagsPanel(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: TagsActions): { focusAdd(): void } {
  const panel = document.createElement("aside");
  panel.className = "layers-panel tags-panel";
  panel.setAttribute("aria-label", "Tags");
  panel.dataset["testid"] = "tags-panel";
  host.appendChild(panel);
  let scheduled = false;
  let filter = "";
  /** The tag being renamed (lower-cased) and the text typed so far. */
  let renaming: { key: string; value: string } | null = null;
  /** The box that had the focus before a redraw, so typing carries on (a name or a tag being typed is never redrawn under the cursor). */
  let refocus: string | null = null;

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.tagsOpen;
    if (!editor.tagsOpen) return;
    const active = document.activeElement as HTMLInputElement | null;
    if (active && panel.contains(active) && active.matches("input")) {
      if (active.value) return;
      refocus = ["data-tag-add", "data-tag-filter", "data-tag-rename"].find((a) => active.hasAttribute(a)) ?? null;
    }
    // Every tag of this canvas, as first spelled, with the items that carry it.
    const tags = new Map<string, { label: string; ids: string[] }>();
    for (const o of doc.ordered()) {
      for (const t of o.tags ?? []) {
        const e = tags.get(t.toLowerCase()) ?? { label: t, ids: [] };
        e.ids.push(o.id);
        tags.set(t.toLowerCase(), e);
      }
    }
    const sel = [...editor.selection].map((id) => doc.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
    const onSel = new Map<string, number>();
    for (const o of sel) for (const t of o.tags ?? []) onSel.set(t.toLowerCase(), (onSel.get(t.toLowerCase()) ?? 0) + 1);
    const sorted = [...tags].sort((a, b) => a[1].label.localeCompare(b[1].label));
    const chips = sorted
      .filter(([k]) => onSel.has(k))
      .map(([k, e]) => {
        const n = onSel.get(k)!;
        const partial = n < sel.length;
        return `<span class="tag-chip${partial ? " is-partial" : ""}" title="${partial ? `On ${n} of the ${sel.length} selected items` : "On every selected item"}">#${esc(e.label)}<button type="button" data-untag="${esc(e.label)}" aria-label="Remove tag ${esc(e.label)} from the selection">×</button></span>`;
      })
      .join("");
    const free = sorted.filter(([k]) => (onSel.get(k) ?? 0) < sel.length).slice(0, SUGGESTIONS);
    const suggest = sel.length
      ? free.map(([, e]) => `<button type="button" class="tag-chip is-suggest" data-add-tag="${esc(e.label)}" aria-label="Add the tag ${esc(e.label)} to the selection">+ #${esc(e.label)}</button>`).join("")
      : "";
    const q = filter.trim().toLowerCase();
    const shown = sorted.filter(([k]) => !q || k.includes(q.replace(/^#/, "")));
    const rows = shown
      .map(([k, e]) =>
        renaming?.key === k
          ? `<li class="tag-row"><input class="tag-input" data-tag-rename="${esc(e.label)}" value="${esc(renaming.value)}" aria-label="New name for tag ${esc(e.label)} on every canvas" maxlength="64"></li>`
          : `<li class="tag-row"><button type="button" class="tag-row-main" data-select-tag="${esc(k)}" aria-label="Select the ${e.ids.length} item${e.ids.length === 1 ? "" : "s"} tagged ${esc(e.label)}" title="Select the items with this tag (Shift: add them to the selection)"><span class="tag-row-name">#${esc(e.label)}</span><span class="tag-row-n">${e.ids.length}</span></button>${moreButton(`More actions for tag ${e.label}`, `data-tag-more="${esc(e.label)}"`)}</li>`,
      )
      .join("");
    panel.innerHTML = panelHtml({
      title: "Tags",
      count: tags.size,
      body: `<div class="tags-body">
        <section class="layers-tags" data-testid="canvas-tags" aria-label="Tags of the selection">
          <h3>${sel.length ? `On the selection <span class="tags-sub">${sel.length} item${sel.length === 1 ? "" : "s"}</span>` : "On the selection"}</h3>
          ${sel.length ? "" : `<p class="tags-hint">Select items on the canvas to tag them.</p>`}
          <div class="tag-chips">${chips}<input class="tag-input" data-tag-add list="tags-suggest" placeholder="${sel.length ? "Add a tag" : "Select items to tag"}" aria-label="Add a tag to the selection" maxlength="64" ${sel.length ? "" : "disabled"}><datalist id="tags-suggest">${free.map(([, e]) => `<option value="${esc(e.label)}">`).join("")}</datalist></div>
          ${suggest ? `<div class="tag-chips tags-suggest">${suggest}</div>` : ""}
          <p class="tags-rules">Tags use letters, numbers, <code>_</code> <code>-</code> and <code>/</code> (<code>project/design</code> is nested). No spaces.</p>
        </section>
        <section class="tags-canvas" aria-label="Tags on this canvas">
          <h3>On this canvas</h3>
          ${tags.size > FILTER_FROM ? `<div class="layers-filter"><input data-tag-filter type="search" placeholder="Filter ${tags.size} tags" aria-label="Filter the tags of this canvas" autocomplete="off" value="${esc(filter)}"></div>` : ""}
          <ul aria-label="Tags on this canvas">${rows || `<li class="layers-empty">${tags.size ? "No tag matches." : "No tags yet. Select items and add one above."}</li>`}</ul>
        </section>
      </div>`,
    });
    if (refocus) {
      const el = panel.querySelector<HTMLInputElement>(`[${refocus}]`);
      el?.focus();
      if (refocus === "data-tag-rename") el?.select();
      refocus = null;
    }
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  editor.subscribe(schedule);
  render();

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-close]")) {
      editor.tagsOpen = false;
      editor.changed();
      return;
    }
    const untag = t.closest<HTMLElement>("[data-untag]");
    if (untag) return void actions.tag([...editor.selection], { remove: [untag.dataset["untag"]!] });
    const add = t.closest<HTMLElement>("[data-add-tag]");
    if (add) return void actions.tag([...editor.selection], { add: [add.dataset["addTag"]!] });
    const pick = t.closest<HTMLElement>("[data-select-tag]");
    if (pick) {
      const ids = doc.ordered().filter((o) => (o.tags ?? []).some((x) => x.toLowerCase() === pick.dataset["selectTag"])).map((o) => o.id);
      editor.entered = [];
      editor.select(ids, e.shiftKey || e.ctrlKey || e.metaKey);
      return;
    }
    const more = t.closest<HTMLElement>("[data-tag-more]");
    if (more) {
      const tag = more.dataset["tagMore"]!;
      const key = tag.toLowerCase();
      openMoreMenu(
        more,
        [
          { label: "Select the items with this tag", icon: ICONS.pointer, aria: `Select the items tagged ${tag}`, run: () => { editor.entered = []; editor.select(doc.ordered().filter((o) => (o.tags ?? []).some((x) => x.toLowerCase() === key)).map((o) => o.id)); } },
          { label: "Rename on every canvas", icon: ICONS.textCursorInput, aria: `Rename tag ${tag}`, run: () => { renaming = { key, value: tag }; refocus = "data-tag-rename"; render(); } },
          { label: "Delete from every canvas", icon: ICONS.trash2, danger: true, aria: `Delete tag ${tag}`, run: () => actions.deleteTag(tag) },
        ],
        `Actions for tag ${tag}`,
      );
    }
  });
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-tag-filter]")) {
      filter = t.value;
      refocus = "data-tag-filter";
      render();
    } else if (t.matches("[data-tag-rename]") && renaming) renaming.value = t.value;
  });
  panel.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches?.("input")) return;
    e.stopPropagation(); // typing here never reaches the canvas shortcuts
    if (t.matches("[data-tag-add]")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const list = t.value.split(",");
        t.value = "";
        refocus = "data-tag-add";
        if (list.join("").trim()) actions.tag([...editor.selection], { add: list });
        else render();
      } else if (e.key === "Escape") {
        t.value = "";
        t.blur();
        render();
      }
    } else if (t.matches("[data-tag-rename]")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const from = t.dataset["tagRename"]!;
        const to = t.value;
        renaming = null;
        t.blur(); // a box with text in it is never redrawn: let go of it first
        if (to.trim() && to.trim().replace(/^#+/, "") !== from) actions.renameTag(from, to);
        render();
      } else if (e.key === "Escape") {
        renaming = null;
        t.blur();
        render();
      }
    } else if (t.matches("[data-tag-filter]") && e.key === "Escape") {
      filter = "";
      t.blur();
      render();
    }
  });
  return { focusAdd: () => panel.querySelector<HTMLInputElement>("[data-tag-add]")?.focus() };
}
