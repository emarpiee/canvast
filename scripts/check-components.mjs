// The component audit: each kind of shared component has one owner file. Markup or code that makes one anywhere else fails here, so a copy cannot
// slip in. `known` lists the places that are still their own, each with why, and may only shrink. Menus: `MenuItem` needs `icon` and `hint`, so the
// compiler holds every row to them; tests/e2e/components.spec.ts opens the real ones.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RULES = [
  { name: "Show more", re: /Show fewer|class="[^"]*show-more/, owners: ["src/ui/show-more.ts"] },
  { name: "Modal dialogs", re: /createElement\("dialog"\)/, owners: ["src/ui/modal.ts"] },
  {
    name: "Menus",
    re: /role="menu"|setAttribute\("role", "menu"\)/,
    owners: ["src/ui/more-menu.ts"],
    known: { "src/ui/navigator.ts": "the workspace list opens as a panel with a filter", "src/ui/assets-view.ts": "Place on: a chooser of canvases with a filter" },
  },
  { name: "Menu rows", re: /role="menuitem"/, owners: ["src/ui/more-menu.ts"], known: { "src/ui/assets-view.ts": "Place on: a chooser of canvases with a filter" } },
  { name: "Trees", re: /class="(tg|tree|tree-twist)["\s]/, owners: ["src/ui/tree.ts"] },
  { name: "Panels", re: /class="panel-(head|sub|body|foot)\b/, owners: ["src/ui/panel.ts"] },
  { name: "Docks", re: /class="dock["\s]/, owners: ["src/ui/toolbar.ts"] },
  { name: "Notices", re: /class="notice["\s]|className = "notice["\s]/, owners: ["src/ui/notices.ts"] },
  { name: "Settings rows", re: /class="[^"]*\bset-row\b/, owners: ["src/ui/settings-view.ts"] },
  { name: "Library cards", re: /class="[^"]*\basset-card\b/, owners: ["src/ui/assets-view.ts"], known: { "src/ui/trash-view.ts": "the Trash's cards, the same classes with its own contents" } },
];
const RETIRED_CSS = [".side-menu", ".nav-actions", ".layer-twist"];

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
const all = files("src").map((p) => relative(".", p).split(sep).join("/"));
const failed = [];
for (const r of RULES) {
  const inUse = new Set();
  for (const f of all) {
    if (!r.re.test(readFileSync(f, "utf8"))) continue;
    if (r.owners.includes(f)) continue;
    if (r.known?.[f]) inUse.add(f);
    else failed.push(`${r.name}: ${f} makes its own. Use ${r.owners.join(" or ")}.`);
  }
  for (const f of Object.keys(r.known ?? {})) if (!inUse.has(f)) failed.push(`${r.name}: ${f} no longer makes its own: take it off the known list.`);
  console.log(`${r.name}: ${r.owners.join(", ")}${r.known ? `; still their own: ${Object.keys(r.known).join(", ")}` : ""}`);
}
// A menu row's description is very short, wherever it is written.
const HINT_MAX = 44;
for (const f of all) for (const m of readFileSync(f, "utf8").matchAll(/\bhint: "([^"]*)"/g)) if (m[1].length > HINT_MAX) failed.push(`Menu rows: ${f}: "${m[1]}" is over ${HINT_MAX} characters.`);
const css = readFileSync("src/styles.css", "utf8");
// One arrow for what opens: the chevron icon or --chevron-mask, never a character.
for (const f of [...all, "src/styles.css", "src/index.html"]) if (/[▾▼▿▽⌄˅⏷]/.test(readFileSync(f, "utf8"))) failed.push(`Arrows: ${f} writes an arrow as a character. Use ICONS.chevronDown or --chevron-mask.`);
for (const c of RETIRED_CSS) if (css.includes(c)) failed.push(`src/styles.css still styles ${c}, which the shared component replaced.`);
if (failed.length) {
  console.error(`\ncheck:components failed:\n${failed.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("check:components ok");
