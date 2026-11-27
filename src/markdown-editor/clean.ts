// Rendered HTML made safe to show (the preview, a table's cells): no scripts, frames, forms or event attributes, no script addresses.
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const n of doc.body.querySelectorAll("script, style, iframe, frame, object, embed, link, meta, base, form, textarea, select, button")) n.remove();
  for (const n of doc.body.querySelectorAll("*")) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction|srcdoc)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) || a.name === "srcdoc") n.removeAttribute(a.name);
    }
    if (n.tagName === "INPUT" && (n as HTMLInputElement).type !== "checkbox") n.remove();
  }
  return doc.body.innerHTML;
}
