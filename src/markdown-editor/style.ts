// The editor's stylesheet. Every colour, size and space is a `--me-*` custom property with its default here, at specificity 0 (`:where`), so a host
// sets the look by setting those properties (or overriding a rule) on `.me` or round it. Light by default; dark with `data-me-theme="dark"`
// on the editor or round it, or the system's when `data-me-theme="auto"`.

const LIGHT = `
  --me-bg: oklch(1 0 0); --me-fg: oklch(0.26 0.01 260); --me-muted: oklch(0.5 0.02 260); --me-faint: oklch(0.5 0.015 260); --me-line: oklch(0.92 0.005 260); --me-accent: oklch(0.52 0.18 262);
  --me-code-bg: oklch(0.965 0.003 260); --me-mark-bg: oklch(0.95 0.12 100); --me-mark-fg: inherit; --me-tag-bg: oklch(0.94 0.03 262); --me-tag-fg: oklch(0.46 0.15 262); --me-select: oklch(0.88 0.06 262);
  --me-tok-keyword: oklch(0.46 0.18 310); --me-tok-string: oklch(0.47 0.13 150); --me-tok-comment: oklch(0.5 0.02 260); --me-tok-number: oklch(0.5 0.14 55); --me-tok-function: oklch(0.46 0.15 262); --me-tok-tag: oklch(0.48 0.18 25);
  --me-blue: oklch(0.55 0.15 255); --me-green: oklch(0.55 0.13 150); --me-purple: oklch(0.52 0.17 305); --me-yellow: oklch(0.62 0.13 75); --me-red: oklch(0.55 0.19 25); --me-grey: oklch(0.55 0.01 260);`;
const DARK = `
  --me-bg: oklch(0.23 0.01 260); --me-fg: oklch(0.93 0.005 260); --me-muted: oklch(0.76 0.01 260); --me-faint: oklch(0.72 0.01 260); --me-line: oklch(0.33 0.01 260); --me-accent: oklch(0.76 0.12 262);
  --me-code-bg: oklch(0.28 0.01 260); --me-mark-bg: oklch(0.42 0.08 95); --me-mark-fg: inherit; --me-tag-bg: oklch(0.31 0.05 262); --me-tag-fg: oklch(0.83 0.08 262); --me-select: oklch(0.38 0.08 262);
  --me-tok-keyword: oklch(0.8 0.11 310); --me-tok-string: oklch(0.84 0.1 150); --me-tok-comment: oklch(0.74 0.02 260); --me-tok-number: oklch(0.83 0.1 60); --me-tok-function: oklch(0.82 0.08 262); --me-tok-tag: oklch(0.78 0.11 20);
  --me-blue: oklch(0.74 0.12 255); --me-green: oklch(0.76 0.12 150); --me-purple: oklch(0.74 0.12 305); --me-yellow: oklch(0.8 0.12 85); --me-red: oklch(0.72 0.15 25); --me-grey: oklch(0.7 0.01 260);`;

export const EDITOR_CSS = `
:where(.me) {${LIGHT}
  --me-font: system-ui, sans-serif; --me-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; --me-size: 16px; --me-line-height: 1.6;
  --me-width: 46rem; --me-pad: 24px; --me-gap: 6px; --me-radius: 6px; --me-btn: 30px; --me-icon: 18px;
  --me-h1: 1.9em; --me-h2: 1.5em; --me-h3: 1.25em; --me-h4: 1.1em; --me-h5: 1em; --me-h6: 0.95em;
  display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--me-bg); color: var(--me-fg); font-family: var(--me-font); font-size: var(--me-size);
}
:where([data-me-theme="dark"] .me, .me[data-me-theme="dark"]) {${DARK}}
@media (prefers-color-scheme: dark) { :where([data-me-theme="auto"] .me, .me[data-me-theme="auto"]) {${DARK}} }
:where(.me-toolbar) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--me-gap); padding: var(--me-gap); border-bottom: 1px solid var(--me-line); flex: none; }
:where(.me-group) { display: flex; align-items: center; gap: 2px; }
:where(.me-group + .me-group) { border-left: 1px solid var(--me-line); padding-left: var(--me-gap); }
:where(.me-btn) { display: inline-grid; place-items: center; min-width: var(--me-btn); height: var(--me-btn); padding: 0 4px; border: 0; border-radius: var(--me-radius); background: none; color: var(--me-muted); cursor: pointer; font: inherit; font-size: 0.8em; }
:where(.me-btn svg) { width: var(--me-icon); height: var(--me-icon); }
:where(.me-btn:hover) { background: var(--me-code-bg); color: var(--me-fg); }
:where(.me-btn[aria-pressed="true"]) { background: var(--me-select); color: var(--me-fg); }
:where(.me-btn:disabled) { opacity: 0.4; cursor: default; }
:where(.me-body) { position: relative; flex: 1; min-height: 0; overflow: hidden; }
:where(.me-body > .cm-editor) { height: 100%; }
/* both editing modes: how Markdown reads (highlight.ts) */
:where(.me) :is(.me-t-h1, .me-t-h2, .me-t-h3, .me-t-h4, .me-t-h5, .me-t-h6) { font-weight: 700; line-height: 1.3; }
:where(.me) .me-t-h1 { font-size: var(--me-h1); } :where(.me) .me-t-h2 { font-size: var(--me-h2); } :where(.me) .me-t-h3 { font-size: var(--me-h3); }
:where(.me) .me-t-h4 { font-size: var(--me-h4); } :where(.me) .me-t-h5 { font-size: var(--me-h5); } :where(.me) .me-t-h6 { font-size: var(--me-h6); color: var(--me-muted); }
:where(.me) .me-t-em { font-style: italic; } :where(.me) .me-t-strong { font-weight: 700; } :where(.me) .me-t-strike { text-decoration: line-through; }
:where(.me) .me-t-hl, :where(.me) .me-mark { background: var(--me-mark-bg); color: var(--me-mark-fg); border-radius: 2px; }
:where(.me) .me-t-link { color: var(--me-accent); }
:where(.me) .me-t-mono { font-family: var(--me-mono); font-size: 0.92em; background: var(--me-code-bg); padding: 1px 4px; border-radius: 4px; }
:where(.me) .me-t-mark { color: var(--me-faint); }
:where(.me) .me-t-quote { font-style: italic; }
:where(.me) .me-t-tag, :where(.me) .me-tag { color: var(--me-tag-fg); background: var(--me-tag-bg); border-radius: 4px; padding: 0 3px; }
:where(.me) .me-code-line, :where(.me) .me-code-line span { font-family: var(--me-mono); }
:where(.me) .me-code-line .me-t-mono { background: transparent; padding: 0; border-radius: 0; font-size: 0.92em; }
/* live mode */
:where(.me-live) .me-link { color: var(--me-accent); text-decoration: underline; text-decoration-color: color-mix(in oklch, var(--me-accent) 40%, transparent); text-underline-offset: 2px; cursor: text; }
:where(.me-live) .me-quote { border-left: 3px solid color-mix(in oklch, var(--me-accent) 45%, transparent); padding-left: 16px !important; color: var(--me-muted); }
:where(.me-live) .me-quote .me-t-quote, :where(.me-live) .me-callout .me-t-quote { font-style: normal; color: inherit; }
:where(.me-live) .me-callout { --me-callout: var(--me-grey); background: color-mix(in oklch, var(--me-callout) 8%, transparent); border-left: 1px solid color-mix(in oklch, var(--me-callout) 35%, transparent); border-right: 1px solid color-mix(in oklch, var(--me-callout) 35%, transparent); padding-left: 14px !important; padding-right: 14px !important; }
:where(.me-live) .me-callout-note { --me-callout: var(--me-blue); } :where(.me-live) .me-callout-tip { --me-callout: var(--me-green); } :where(.me-live) .me-callout-question { --me-callout: var(--me-purple); }
:where(.me-live) .me-callout-warning { --me-callout: var(--me-yellow); } :where(.me-live) .me-callout-danger { --me-callout: var(--me-red); } :where(.me-live) .me-callout-quote { --me-callout: var(--me-grey); }
:where(.me-live) .me-callout-head { border-top: 1px solid color-mix(in oklch, var(--me-callout) 35%, transparent); border-top-left-radius: 8px; border-top-right-radius: 8px; padding-top: 4px; font-weight: 600; color: var(--me-callout); }
:where(.me-live) .me-callout-foot { border-bottom: 1px solid color-mix(in oklch, var(--me-callout) 35%, transparent); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; padding-bottom: 4px; }
:where(.me-live) .me-callout-title { font-weight: 600; color: var(--me-callout); }
:where(.me-live) .me-bullet { color: var(--me-muted); display: inline-block; width: 1.1em; }
:where(.me-live) .me-list-number { color: var(--me-muted); }
:where(.me-live) .me-task-box { display: inline-flex; align-items: center; justify-content: center; vertical-align: text-bottom; width: 1.05em; height: 1.05em; margin-right: 0.3em; }
:where(.me-live) .me-task { appearance: none; -webkit-appearance: none; position: relative; width: 1em; height: 1em; margin: 0; border: 1.5px solid var(--me-line); border-radius: 4px; background: var(--me-bg); cursor: pointer; }
:where(.me-live) .me-task:hover { border-color: var(--me-accent); }
:where(.me-live) .me-task:checked { border-color: var(--me-accent); background: var(--me-accent); }
:where(.me-live) .me-task:checked::after { content: ""; position: absolute; left: 50%; top: 45%; width: 0.32em; height: 0.6em; border: solid var(--me-bg); border-width: 0 0.16em 0.16em 0; transform: translate(-50%, -55%) rotate(45deg); }
:where(.me-live) .me-done { color: var(--me-faint); text-decoration: line-through; }
:where(.me-live) .me-rule { display: inline-block; width: 100%; height: 0; border-top: 2px solid var(--me-line); vertical-align: middle; }
:where(.me-live) .me-code-card { position: relative; background: color-mix(in oklch, var(--me-code-bg) 80%, transparent); line-height: 1.7; border-left: 1px solid var(--me-line); border-right: 1px solid var(--me-line); padding-left: 16px !important; padding-right: 16px !important; }
:where(.me-live) .me-code-begin { border-top: 1px solid var(--me-line); border-top-left-radius: 8px; border-top-right-radius: 8px; }
:where(.me-live) .me-code-end { border-bottom: 1px solid var(--me-line); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }
:where(.me-live) .me-code-flair { position: absolute; top: 3px; right: 8px; z-index: 2; display: inline-flex; align-items: center; gap: 2px; font-family: var(--me-font); font-size: 11px; line-height: 1.5; white-space: nowrap; }
:where(.me-live) :is(.me-code-lang, .me-code-copy) { display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--me-faint); font: inherit; cursor: pointer; }
:where(.me-live) .me-code-lang { gap: 3px; padding: 0 5px 0 7px; } :where(.me-live) .me-code-lang svg { width: 11px; height: 11px; opacity: 0.7; } :where(.me-live) .me-code-copy { width: 20px; height: 18px; padding: 0; }
:where(.me-live) :is(.me-code-lang, .me-code-copy):hover { background: var(--me-line); color: var(--me-fg); }
:where(.me-media) { display: inline-block; color: var(--me-faint); font-size: 0.9em; }
:where(.me-media img, .me-media video) { display: block; max-width: 100%; height: auto; border-radius: var(--me-radius); }
:where(.me-table) { padding: 4px 0; cursor: default; }
:where(.me-table-box) { position: relative; display: inline-grid; grid-template-columns: minmax(0, auto) 14px; grid-template-rows: auto 14px; gap: 2px; max-width: 100%; vertical-align: top; }
:where(.me-table-scroll) { grid-column: 1; grid-row: 1; overflow-x: auto; border: 1px solid var(--me-line); border-radius: 6px; }
:where(.me-table) table, :where(.me-preview) table { border-collapse: collapse; margin: 0; }
:where(.me-preview) table { margin: 4px 0; }
:where(.me-table, .me-preview) :is(th, td) { border: 1px solid var(--me-line); padding: 8px 12px; min-width: 6em; height: 2.4em; box-sizing: border-box; text-align: left; vertical-align: top; }
:where(.me-table) tr:first-child > * { border-top: 0; } :where(.me-table) tr:last-child > * { border-bottom: 0; }
:where(.me-table) tr > :first-child { border-left: 0; } :where(.me-table) tr > :last-child { border-right: 0; }
:where(.me-table, .me-preview) th { background: var(--me-code-bg); font-weight: 600; }
:where(.me-table) :is(th, td) { outline: none; cursor: text; }
:where(.me-table) :is(th, td):focus { box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--me-accent) 60%, transparent); }
:where(.me-table-add) { display: grid; place-items: center; padding: 0; border: 0; border-radius: 4px; background: var(--me-code-bg); color: var(--me-faint); font: inherit; font-size: 11px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
:where(.me-table:hover) .me-table-add, :where(.me-table:focus-within) .me-table-add { opacity: 1; }
:where(.me-table-add):hover { color: var(--me-fg); background: var(--me-line); }
:where(.me-table-add-col) { grid-column: 2; grid-row: 1; }
:where(.me-table-grip) { position: absolute; left: -14px; width: 12px; display: grid; place-items: center; border-radius: 4px; background: var(--me-code-bg); color: var(--me-faint); cursor: grab; opacity: 0; transition: opacity 0.12s; touch-action: none; }
:where(.me-table:hover) .me-table-grip { opacity: 1; }
:where(.me-table-grip[hidden]) { display: none; }
:where(.me-table-grip.is-dragging) { cursor: grabbing; color: var(--me-fg); }
:where(.me-table) tr.me-drop-target > * { box-shadow: inset 0 -2px 0 var(--me-accent); }
:where(.me-table-add-row) { grid-column: 1; grid-row: 2; }
:where(.me) .me-list-line { padding-left: var(--me-hang) !important; text-indent: calc(-1 * var(--me-hang)); }
:where(.me) .me-list-line > * { text-indent: 0; }
/* folding */
:where(.me) .me-foldable { position: relative; }
:where(.me) .me-fold { position: absolute; left: -18px; top: 0.35em; display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; color: var(--me-faint); cursor: pointer; opacity: 0; transition: opacity 0.12s, transform 0.12s; text-indent: 0; }
:where(.me) .me-foldable:hover .me-fold, :where(.me) .me-fold-cursor .me-fold, :where(.me) .me-fold.is-folded { opacity: 1; }
:where(.me) .me-fold.is-folded { transform: rotate(-90deg); }
:where(.me) .me-fold:hover { color: var(--me-fg); background: var(--me-code-bg); }
:where(.me) .cm-foldPlaceholder { background: var(--me-code-bg); border: 1px solid var(--me-line); border-radius: 4px; color: var(--me-faint); padding: 0 6px; margin-left: 6px; }
/* task states, broken links, coloured highlights, resizing pictures */
:where(.me-live) .me-task-state { box-sizing: border-box; width: 1em; height: 1em; border: 1.5px solid var(--me-line); border-radius: 4px; vertical-align: text-bottom; position: relative; }
:where(.me-live) .me-task-progress { background: linear-gradient(90deg, var(--me-accent) 50%, transparent 50%); border-color: var(--me-accent); cursor: pointer; }
:where(.me-live) .me-task-cancelled::after { content: ""; position: absolute; inset: 2px; background: var(--me-faint); mask: linear-gradient(45deg, transparent 43%, #000 43% 57%, transparent 57%), linear-gradient(-45deg, transparent 43%, #000 43% 57%, transparent 57%); }
:where(.me-live) .me-task-forwarded::after { content: ""; position: absolute; inset: 1px; background: var(--me-accent); mask: linear-gradient(#000 0 0) center / 60% 2px no-repeat, linear-gradient(45deg, transparent 50%, #000 50%) right 15% center / 40% 40% no-repeat; }
:where(.me-live) .me-cancelled { color: var(--me-faint); text-decoration: line-through; }
:where(.me-live) .me-wikilink-broken { color: var(--me-faint); text-decoration-style: dashed; text-decoration-color: var(--me-faint); }
:where(.me) .me-hl-orange { background: color-mix(in oklch, var(--me-yellow) 40%, var(--me-red) 20%); } :where(.me) .me-hl-red { background: color-mix(in oklch, var(--me-red) 30%, transparent); }
:where(.me) .me-hl-pink { background: color-mix(in oklch, var(--me-red) 18%, var(--me-purple) 14%); } :where(.me) .me-hl-purple { background: color-mix(in oklch, var(--me-purple) 30%, transparent); }
:where(.me) .me-hl-blue { background: color-mix(in oklch, var(--me-blue) 30%, transparent); } :where(.me) .me-hl-green { background: color-mix(in oklch, var(--me-green) 30%, transparent); }
:where(.me) .me-hl-gray { background: color-mix(in oklch, var(--me-grey) 30%, transparent); }
:where(.me-media) { position: relative; }
:where(.me-resize) { position: absolute; right: 4px; bottom: 4px; width: 12px; height: 12px; border-right: 2px solid var(--me-bg); border-bottom: 2px solid var(--me-bg); box-shadow: 1px 1px 0 var(--me-fg); cursor: nwse-resize; opacity: 0; touch-action: none; }
:where(.me-media:hover) .me-resize { opacity: 1; }
/* the package's lists of choices (popover.ts) */
:where(.me-pop) { position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 12em; max-height: min(24rem, 70vh); overflow: auto; padding: 4px; background: var(--me-bg); color: var(--me-fg); border: 1px solid var(--me-line); border-radius: var(--me-radius); box-shadow: 0 8px 24px color-mix(in oklch, var(--me-fg) 20%, transparent); font-family: var(--me-font); font-size: 13px; }
:where(.me-pop-item) { display: flex; justify-content: space-between; gap: 12px; padding: 4px 8px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
:where(.me-pop-item:hover, .me-pop-item:focus-visible) { background: var(--me-code-bg); outline: none; }
:where(.me-pop-item.is-on) { color: var(--me-accent); font-weight: 600; }
:where(.me-pop-item:disabled) { opacity: 0.4; cursor: default; }
:where(.me-pop-item small) { color: var(--me-faint); }
:where(.me-pop-sep) { height: 1px; margin: 4px 2px; background: var(--me-line); }
/* table cells and columns */
:where(.me-table) .me-cell { outline: none; min-height: 1.4em; cursor: text; }
:where(.me-table) th { position: relative; }
:where(.me-col-resize) { position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; z-index: 1; }
:where(.me-col-resize):hover { background: color-mix(in oklch, var(--me-accent) 40%, transparent); }
:where(.me-col-grip) { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); display: grid; place-items: center; width: 22px; height: 12px; border-radius: 4px; background: var(--me-code-bg); color: var(--me-faint); cursor: grab; opacity: 0; touch-action: none; }
:where(.me-table:hover) .me-col-grip { opacity: 1; }
:where(.me-table) th.me-drop-target { box-shadow: inset -2px 0 0 var(--me-accent); }
:where(.me-live) .me-code-lang.is-detected { border: 1px dashed var(--me-line); opacity: 0.85; }
/* math and diagrams */
:where(.me) .me-math { cursor: pointer; }
:where(.me) .me-math-block { display: block; text-align: center; padding: 6px 0; overflow-x: auto; }
:where(.me) .me-math-error { color: var(--me-red); font-family: var(--me-mono); font-size: 0.9em; }
:where(.me) .me-diagram, :where(.me-preview) .me-diagram { display: block; text-align: center; padding: 8px 0; overflow-x: auto; cursor: pointer; }
:where(.me) .me-diagram svg, :where(.me-preview) .me-diagram svg { max-width: 100%; height: auto; }
:where(.me-preview) .math-block { display: block; text-align: center; margin: 0.6em 0; overflow-x: auto; }
/* the link popover */
:where(.me-link-pop) { position: fixed; z-index: 1000; display: flex; flex-direction: column; width: min(30rem, calc(100vw - 16px)); max-height: min(22rem, 60vh); background: var(--me-bg); color: var(--me-fg); border: 1px solid var(--me-line); border-radius: 8px; box-shadow: 0 10px 30px color-mix(in oklch, var(--me-fg) 22%, transparent); overflow: hidden; font-family: var(--me-font); }
:where(.me-link-pop-head) { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--me-line); font-size: 13px; }
:where(.me-link-pop-title) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
:where(.me-link-pop-btn) { width: auto; padding: 0 8px; font-size: 12px; color: var(--me-accent); }
:where(.me-link-pop-body) { flex: 1; min-height: 6rem; overflow: auto; padding: 4px 0; font-size: 0.9em; color: var(--me-muted); }
:where(.me-link-pop-body) > .me { height: auto; min-height: 6rem; --me-pad: 12px; }
:where(.me-link-pop-body) img, :where(.me-link-pop-body) video { display: block; max-width: 100%; margin: 8px auto; border-radius: var(--me-radius); }
/* the date picker */
:where(.me-date) { flex-direction: row; align-items: center; gap: 6px; padding: 6px; min-width: 0; }
:where(.me-date) input { font: inherit; color: var(--me-fg); background: var(--me-code-bg); border: 1px solid var(--me-line); border-radius: 4px; padding: 2px 6px; }
/* the bar over selected words */
:where(.me-selbar) { position: relative; display: flex; align-items: center; gap: 2px; padding: 3px; }
:where(.me-selbar-turn) { padding: 0 8px; font-size: 0.85em; color: var(--me-fg); }
:where(.me-selbar-menu) { position: absolute; top: 100%; left: 0; margin-top: 4px; display: flex; flex-direction: column; min-width: 12em; padding: 4px; background: var(--me-bg); border: 1px solid var(--me-line); border-radius: var(--me-radius); box-shadow: 0 6px 20px color-mix(in oklch, var(--me-fg) 18%, transparent); }
:where(.me-selbar-menu[hidden]) { display: none; }
:where(.me-selbar-item) { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 0; border-radius: var(--me-radius); background: none; color: var(--me-fg); font: inherit; font-size: 0.9em; text-align: left; cursor: pointer; }
:where(.me-selbar-item):hover { background: var(--me-code-bg); }
:where(.me-selbar-item) svg { width: var(--me-icon); height: var(--me-icon); color: var(--me-muted); }
:where(.me .me-tok-keyword) { color: var(--me-tok-keyword); } :where(.me .me-tok-string) { color: var(--me-tok-string); } :where(.me .me-tok-comment) { color: var(--me-tok-comment); font-style: italic; }
:where(.me .me-tok-number) { color: var(--me-tok-number); } :where(.me .me-tok-function) { color: var(--me-tok-function); } :where(.me .me-tok-tag) { color: var(--me-tok-tag); }
/* preview mode */
:where(.me-preview) { position: absolute; inset: 0; overflow: auto; padding: var(--me-pad) 0; line-height: var(--me-line-height); background: var(--me-bg); color: var(--me-fg); }
:where(.me-preview > .me-page) { max-width: var(--me-width); margin: 0 auto; padding: 0 var(--me-pad); }
:where(.me-preview) :is(h1, h2, h3, h4, h5, h6) { line-height: 1.3; margin: 1em 0 0.4em; }
:where(.me-preview) h1 { font-size: var(--me-h1); } :where(.me-preview) h2 { font-size: var(--me-h2); } :where(.me-preview) h3 { font-size: var(--me-h3); }
:where(.me-preview) a { color: var(--me-accent); cursor: pointer; }
:where(.me-preview) code { font-family: var(--me-mono); font-size: 0.9em; background: var(--me-code-bg); border-radius: 3px; padding: 0 2px; }
:where(.me-preview) pre { background: var(--me-code-bg); border-radius: var(--me-radius); padding: 10px 12px; overflow-x: auto; }
:where(.me-preview) pre code { background: none; padding: 0; }
:where(.me-preview) blockquote { border-left: 3px solid var(--me-line); margin: 0.6em 0; padding-left: 12px; color: var(--me-muted); }
:where(.me-preview) mark { background: var(--me-mark-bg); color: var(--me-mark-fg); }
:where(.me-preview) img, :where(.me-preview) video { max-width: 100%; height: auto; border-radius: var(--me-radius); }
:where(.me-preview) li.task { list-style: none; margin-left: -1.3em; }
:where(.me-preview) li.task > input { margin-right: 0.4em; cursor: pointer; }
:where(.me-preview) li.done { color: var(--me-faint); text-decoration: line-through; }
:where(.me-preview) hr { border: 0; border-top: 1px solid var(--me-line); }
:where(.me-preview) .callout { --me-callout: var(--me-blue); margin: 0.8em 0; padding: 8px 14px; border: 1px solid color-mix(in oklch, var(--me-callout) 35%, transparent); border-radius: 8px; background: color-mix(in oklch, var(--me-callout) 8%, transparent); }
:where(.me-preview) .callout-title { font-weight: 600; color: var(--me-callout); }
:where(.me-preview) .callout > p { margin: 0.3em 0; }
:where(.me-preview) .callout:is([data-callout="tip"], [data-callout="hint"], [data-callout="important"], [data-callout="success"], [data-callout="check"], [data-callout="done"]) { --me-callout: var(--me-green); }
:where(.me-preview) .callout:is([data-callout="question"], [data-callout="help"], [data-callout="faq"], [data-callout="example"]) { --me-callout: var(--me-purple); }
:where(.me-preview) .callout:is([data-callout="warning"], [data-callout="warn"], [data-callout="caution"], [data-callout="attention"]) { --me-callout: var(--me-yellow); }
:where(.me-preview) .callout:is([data-callout="danger"], [data-callout="error"], [data-callout="bug"], [data-callout="failure"], [data-callout="fail"], [data-callout="missing"]) { --me-callout: var(--me-red); }
:where(.me-preview) .callout:is([data-callout="quote"], [data-callout="cite"]) { --me-callout: var(--me-grey); }
:where(.me-preview) .task-state { display: inline-block; width: 1em; height: 1em; margin-right: 0.3em; border: 1.5px solid var(--me-line); border-radius: 4px; vertical-align: text-bottom; }
:where(.me-preview) .task-progress { background: linear-gradient(90deg, var(--me-accent) 50%, transparent 50%); border-color: var(--me-accent); }
:where(.me-preview) li.cancelled { color: var(--me-faint); text-decoration: line-through; }
:where(.me-preview) mark[class^="hl-"] { color: inherit; }
:where(.me-preview) .hl-red { background: color-mix(in oklch, var(--me-red) 30%, transparent); } :where(.me-preview) .hl-blue { background: color-mix(in oklch, var(--me-blue) 30%, transparent); }
:where(.me-preview) .hl-green { background: color-mix(in oklch, var(--me-green) 30%, transparent); } :where(.me-preview) .hl-purple { background: color-mix(in oklch, var(--me-purple) 30%, transparent); }
:where(.me-preview) .hl-gray { background: color-mix(in oklch, var(--me-grey) 30%, transparent); }
:where(.me-preview) .tag { color: var(--me-tag-fg); background: var(--me-tag-bg); border-radius: 4px; padding: 0 3px; }
.me.me-plain .cm-editor .cm-scroller { font-family: var(--me-mono); }
/* (preview mode: CodeMirror's own sheet keeps its editor shown, hidden attribute or not) */
.me.me-previewing .cm-editor { display: none !important; }
`;

/** The look of CodeMirror's own elements: given as an editor theme, which outranks CodeMirror's base sheet (a `:where` rule would not). */
export const CM_THEME: Record<string, Record<string, string>> = {
  "&": { backgroundColor: "var(--me-bg)", color: "var(--me-fg)", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--me-font)", lineHeight: "var(--me-line-height)", padding: "var(--me-pad) 0" },
  ".cm-content": { maxWidth: "var(--me-width)", margin: "0 auto", padding: "0 var(--me-pad)", caretColor: "var(--me-fg)", width: "100%", boxSizing: "border-box" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--me-fg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--me-select)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-panels": { backgroundColor: "var(--me-bg)", color: "var(--me-fg)", borderColor: "var(--me-line)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--me-line)" },
  ".cm-panel.cm-search": { padding: "var(--me-gap)", fontFamily: "var(--me-font)" },
  ".cm-panel input, .cm-panel button": { font: "inherit", color: "var(--me-fg)", backgroundColor: "var(--me-code-bg)", backgroundImage: "none", border: "1px solid var(--me-line)", borderRadius: "var(--me-radius)" },
  ".cm-searchMatch": { backgroundColor: "var(--me-mark-bg)" },
  ".cm-tooltip": { backgroundColor: "var(--me-bg)", color: "var(--me-fg)", border: "1px solid var(--me-line)", borderRadius: "var(--me-radius)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px var(--me-gap)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--me-select)", color: "var(--me-fg)" },
  ".cm-completionDetail": { color: "var(--me-faint)", fontStyle: "normal", marginLeft: "var(--me-gap)" },
  ".cm-placeholder": { color: "var(--me-faint)" },
};

let injected = false;
/** Add the stylesheet to the document once. */
export function injectStyles(doc: Document = document): void {
  if (injected || doc.getElementById("me-styles")) return;
  injected = true;
  const s = doc.createElement("style");
  s.id = "me-styles";
  s.textContent = EDITOR_CSS;
  doc.head.append(s);
}
