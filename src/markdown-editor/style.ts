// The editor's stylesheet. Every colour, size and space is a `--me-*` custom property with its default here, at specificity 0 (`:where`), so a host
// sets the look by setting those properties (or overriding a rule) on `.me` or round it. Light by default; dark with `data-me-theme="dark"`
// on the editor or round it, or the system's when `data-me-theme="auto"`.

const LIGHT = `
  --me-bg: oklch(1 0 0); --me-fg: oklch(0.26 0.01 260); --me-muted: oklch(0.5 0.02 260); --me-faint: oklch(0.5 0.015 260); --me-line: oklch(0.92 0.005 260); --me-accent: oklch(0.52 0.18 262);
  --me-code-bg: oklch(0.965 0.003 260); --me-mark-bg: oklch(0.95 0.12 100); --me-mark-fg: inherit; --me-tag-bg: oklch(0.94 0.03 262); --me-tag-fg: oklch(0.46 0.15 262); --me-select: oklch(0.88 0.06 262);
  --me-tok-keyword: oklch(0.46 0.18 310); --me-tok-string: oklch(0.47 0.13 150); --me-tok-comment: oklch(0.5 0.02 260); --me-tok-number: oklch(0.5 0.14 55); --me-tok-function: oklch(0.46 0.15 262); --me-tok-tag: oklch(0.48 0.18 25);`;
const DARK = `
  --me-bg: oklch(0.23 0.01 260); --me-fg: oklch(0.93 0.005 260); --me-muted: oklch(0.76 0.01 260); --me-faint: oklch(0.72 0.01 260); --me-line: oklch(0.33 0.01 260); --me-accent: oklch(0.76 0.12 262);
  --me-code-bg: oklch(0.28 0.01 260); --me-mark-bg: oklch(0.42 0.08 95); --me-mark-fg: inherit; --me-tag-bg: oklch(0.31 0.05 262); --me-tag-fg: oklch(0.83 0.08 262); --me-select: oklch(0.38 0.08 262);
  --me-tok-keyword: oklch(0.8 0.11 310); --me-tok-string: oklch(0.84 0.1 150); --me-tok-comment: oklch(0.74 0.02 260); --me-tok-number: oklch(0.83 0.1 60); --me-tok-function: oklch(0.82 0.08 262); --me-tok-tag: oklch(0.78 0.11 20);`;

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
.me.me-source .cm-editor .cm-scroller { font-family: var(--me-mono); font-size: 0.92em; } /* (above the editor theme's font) */
/* live mode */
:where(.me-live .me-h) { font-weight: 700; line-height: 1.3; }
:where(.me-live .me-h1) { font-size: var(--me-h1); } :where(.me-live .me-h2) { font-size: var(--me-h2); } :where(.me-live .me-h3) { font-size: var(--me-h3); }
:where(.me-live .me-h4) { font-size: var(--me-h4); } :where(.me-live .me-h5) { font-size: var(--me-h5); } :where(.me-live .me-h6) { font-size: var(--me-h6); color: var(--me-muted); }
:where(.me-strong) { font-weight: 700; } :where(.me-em) { font-style: italic; } :where(.me-strike) { text-decoration: line-through; }
:where(.me-mark) { background: var(--me-mark-bg); color: var(--me-mark-fg); border-radius: 2px; }
:where(.me-code) { font-family: var(--me-mono); font-size: 0.9em; background: var(--me-code-bg); border-radius: 3px; padding: 0 2px; }
:where(.me-link) { color: var(--me-accent); text-decoration: underline; text-underline-offset: 2px; cursor: text; }
:where(.me-url) { color: var(--me-faint); }
:where(.me-tag) { color: var(--me-tag-fg); background: var(--me-tag-bg); border-radius: 4px; padding: 0 3px; }
:where(.me-quote) { border-left: 3px solid var(--me-line); padding-left: 12px !important; color: var(--me-muted); }
:where(.me-bullet) { color: var(--me-muted); display: inline-block; width: 1.1em; }
:where(.me-list-number) { color: var(--me-muted); }
:where(.me-task) { margin: 0 0.4em 0 0; vertical-align: middle; cursor: pointer; }
:where(.me-done) { color: var(--me-faint); text-decoration: line-through; }
:where(.me-rule) { display: inline-block; width: 100%; height: 0; border-top: 1px solid var(--me-line); vertical-align: middle; }
:where(.me-live .me-code-block) { font-family: var(--me-mono); font-size: 0.9em; background: var(--me-code-bg); padding-left: 12px !important; padding-right: 12px !important; }
:where(.me-live .me-code-first) { border-top-left-radius: var(--me-radius); border-top-right-radius: var(--me-radius); }
:where(.me-live .me-code-last) { border-bottom-left-radius: var(--me-radius); border-bottom-right-radius: var(--me-radius); }
:where(.me-live .me-fence) { color: var(--me-faint); }
:where(.me-media) { display: inline-block; color: var(--me-faint); font-size: 0.9em; }
:where(.me-media img, .me-media video) { display: block; max-width: 100%; height: auto; border-radius: var(--me-radius); }
:where(.me-table, .me-preview) table { border-collapse: collapse; margin: 4px 0; }
:where(.me-table, .me-preview) :is(th, td) { border: 1px solid var(--me-line); padding: 4px 8px; }
:where(.me-table, .me-preview) th { background: var(--me-code-bg); font-weight: 600; }
:where(.me-table) { cursor: text; overflow-x: auto; }
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
