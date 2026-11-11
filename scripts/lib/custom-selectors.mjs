// `@custom-selector :--name a, b, c;` (the CSS draft), expanded at build time: a rule whose selector holds `:--name` gets one plain selector
// per item, so the browser files each under its own last part (a class or a tag) instead of checking a selector list on every element.
// Only the top level of a rule's selector is expanded; a name used inside a nested block or a pseudo-class's brackets is left as written.
export function expandCustomSelectors(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, ""); // (comments are for the source; a rule's selector is then all that comes before its `{`)
  const defs = new Map();
  css = css.replace(/@custom-selector\s+(:--[\w-]+)\s+([^;]+);/g, (_, name, list) => {
    defs.set(name, splitTop(list).map((s) => s.trim()).filter(Boolean));
    return "";
  });
  if (!defs.size) return css;
  // a rule's prelude: what follows the previous `}` or `;` or `{` up to its `{`
  return css.replace(/(^|[{};])(\s*)([^{};]*?:--[\w-]+[^{};]*)\{/g, (all, lead, space, prelude) => {
    const out = splitTop(prelude).flatMap((sel) => {
      const m = sel.match(/:--[\w-]+/);
      if (!m || !defs.has(m[0])) return [sel.trim()];
      const [before, after] = [sel.slice(0, m.index), sel.slice(m.index + m[0].length)];
      return defs.get(m[0]).map((item) => `${before}${item}${after}`.trim());
    });
    return `${lead}${space}${out.join(",\n")} {`;
  });
}
/** Splits at commas outside brackets. */
function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
