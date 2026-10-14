// Entry for the lazily loaded note editor (ADR 0032). Relative paths: the package's `exports` hides its subpaths.
import suneditor from "../node_modules/suneditor/src/suneditor.js";
import { blockquote, codeBlock, list_bulleted, list_numbered, hr, table, link, blockStyle, textStyle } from "../node_modules/suneditor/src/plugins/index.js";
import { markdown, converter } from "../node_modules/suneditor/src/helper/index.js";

const plugins = { blockquote, codeBlock, list_bulleted, list_numbered, hr, table, link, blockStyle, textStyle };
const buttons = [["blockStyle", "bold", "italic", "strike"], ["list_bulleted", "list_numbered", "blockquote", "codeBlock", "hr", "table", "link"]];

/** Creates the editor in `el` (balloon toolbar: it appears over a selection) and returns Markdown-in, Markdown-out accessors. */
window.__canvastSun = (el) => {
  const ed = suneditor.create(el, { plugins, buttonList: buttons, mode: "balloon", height: "auto", minHeight: "120px", statusbar: false });
  return {
    set: (md) => ed.$.html.set(markdown.markdownToHtml(md)),
    // The converter leaves an empty "> " line after a quote.
    get: () => markdown.jsonToMarkdown(converter.htmlToJson(ed.$.html.get())).replace(/(\n>[ \t]*)+$/, "").trim(),
    focus: () => ed.$.focusManager.focus(),
  };
};
