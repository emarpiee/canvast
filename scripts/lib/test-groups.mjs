// The end-to-end specs in groups, and which changed files need which groups (docs/testing/README.md, "Groups"). Every spec is in
// exactly one group (`checkGroups` fails otherwise). A changed file that no rule names runs every group: a gap here costs time, never coverage.

/** Group → its specs (file names under tests/e2e/, without `.spec.ts`). */
export const GROUPS = {
  navigation: ["navigation", "zoom-controls", "deep-zoom-rendering", "depth-suite", "extreme-depth", "bookmarks", "frames"],
  drawing: ["editing", "vectors", "text", "sheets", "styles", "pattern"],
  rendering: ["tiles", "density", "lowmem"],
  pictures: ["pictures", "files", "screenshot"],
  library: ["assets", "organize", "library-folder"],
  storage: ["storage", "archive", "upgrade"],
  desktop: ["desktop"],
  interface: ["settings", "dock", "a11y", "icon-audit", "scrub-audit"],
  packages: ["colour-picker", "colour-picker-package", "patterns-package"],
  smoke: ["scenarios", "release"],
};
/** Always run, whatever changed: a few whole-app scenarios and the release checks (about a minute). */
export const ALWAYS = ["smoke"];
const ALL = Object.keys(GROUPS);

/**
 * Changed path → groups. The first rule that matches decides; `ALL` for files every part of the app depends on; `[]` for files no
 * end-to-end test reads (the unit tests and the checks still run). Order matters: specific rules before the folder they are in.
 */
export const RULES = [
  // nothing an end-to-end test reads
  [/^(docs\/|README\.md$|CHANGELOG\.md$|CLAUDE\.md$|THIRD_PARTY_NOTICES\.md$|LICENSE$|metrics\/|\.github\/|\.gitignore$|tests\/unit\/|vitest\.config\.ts$|src\/spike\/|scripts\/brand\/|scripts\/test-affected\.mjs$|scripts\/lib\/test-groups\.mjs$|playwright\.(full|bench)\.config\.ts$)/, []],
  // package.json: the app has no runtime dependencies, so only what builds or runs the tests matters
  [/^package\.json$/, (_m, diff) => {
    if (diff === undefined) return ALL;
    const lines = diff.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).join("\n"); // (only what changed, not the lines around it)
    return /"(@playwright\/test|playwright|esbuild|typescript)"|"scripts"|"test/.test(lines) ? ALL : /"electron(-builder)?"/.test(lines) ? ["desktop"] : ["smoke"];
  }],
  [/^package-lock\.json$/, []], // (follows package.json)
  [/\.md$/, []],
  // the specs themselves: their own group
  [/^tests\/e2e\/(.+)\.spec\.ts$/, (m) => [groupOf(m[1])]],
  // the test machinery, the build and the shared heart of the app: everything
  [/^(tests\/e2e\/|playwright\.config\.ts$|scripts\/test-snap\.mjs$|scripts\/build\.mjs$|scripts\/lib\/source-hash\.mjs$|tsconfig\.json$)/, ALL],
  [/^src\/(styles\.css|app\/(main|session|debug-hook|editor-state)\.ts|doc\/(model|document-store)\.ts)$/, ALL],
  // the desktop app
  [/^(desktop\/|tsconfig\.desktop\.json$|scripts\/(build-desktop|package-desktop)\.mjs$|src\/storage\/(desktop-bridge|desktop-storage|workspace-mirror|library-mirror|hidden-store|canvas-file)\.ts$)/, ["desktop"]],
  [/^scripts\/(release\.mjs|lib\/release-notes\.mjs)$/, ["smoke"]],
  [/^scripts\/(build-picker|check-picker)\.mjs$/, ["packages"]],
  [/^scripts\/(build-patterns|check-patterns)\.mjs$/, ["packages", "drawing"]],
  [/^scripts\/(check-tokens|check-storage|check-names|check-offline)\.mjs$/, []],
  // storage and the library
  [/^src\/storage\//, ["storage", "library", "desktop"]],
  [/^src\/assets\/(asset-catalog|asset-library|hidden-lock|sha256)\.ts$/, ["library", "storage", "pictures", "desktop"]],
  [/^src\/assets\//, ["library", "pictures"]],
  [/^src\/ui\/(assets-view|library-[a-z-]+|batch-rename|hidden-access)\.ts$/, ["library"]],
  [/^src\/ui\/(archive-ui|library-folder-card|reset-dialog)\.ts$/, ["storage", "library"]],
  [/^src\/app\/(library-filing|asset-names)\.ts$/, ["library"]],
  // pictures, files and export
  [/^src\/(ui\/(export-dialog|file-actions|media-[a-z-]+|adjust-panel)|app\/(export-[a-z-]+|screenshot|svg-export|pdf-vector|download|font-loader))\.ts$/, ["pictures", "drawing"]],
  // navigation, frames and bookmarks
  [/^src\/(core|scene)\//, ["navigation", "rendering", "drawing", "pictures"]],
  [/^src\/(app\/(bookmarks|bookmark-thumbs|camera-history|frames)|ui\/bookmarks-panel|interaction\/(navigation|item-navigation|random-view|reveal))\.ts$/, ["navigation"]],
  // drawing, rendering, text, patterns
  [/^src\/render\//, ["rendering", "navigation", "drawing", "pictures"]],
  [/^src\/(doc|interaction)\//, ["drawing", "pictures"]],
  [/^src\/text\//, ["drawing"]],
  [/^src\/gen\//, ["drawing", "packages"]],
  [/^src\/colour-picker\//, ["packages", "drawing", "interface"]],
  // the interface
  [/^src\/(settings|commands|search)\//, ["interface", "library"]],
  [/^src\/ui\//, ["interface", "drawing"]],
  [/^src\/app\/(hud|fps-meter|frame-stats|quality|bench|diagnostics)\.ts$/, ["rendering", "interface"]],
];

const SPEC_GROUP = new Map(Object.entries(GROUPS).flatMap(([g, specs]) => specs.map((s) => [s, g])));
/** The group of a spec (a spec in none: every group, so it is never skipped; `checkGroups` reports it). */
function groupOf(spec) {
  return SPEC_GROUP.get(spec) ?? "*";
}

/** The groups a changed path needs (`diff`: its changes, for a rule that looks at what changed in it). */
export function groupsFor(path, diff) {
  for (const [re, to] of RULES) {
    const m = re.exec(path);
    if (!m) continue;
    const gs = typeof to === "function" ? to(m, typeof diff === "function" ? diff(path) : diff) : to;
    return gs.includes("*") ? ALL : gs;
  }
  return ALL; // a file no rule names
}

/** The groups for a set of changed paths, with the paths that decided each (for the report), the always-run ones included. */
export function affected(paths, diff) {
  const why = new Map();
  for (const p of paths) for (const g of groupsFor(p, diff)) (why.get(g) ?? why.set(g, []).get(g)).push(p);
  for (const g of ALWAYS) if (!why.has(g)) why.set(g, ["(always)"]);
  return new Map(ALL.filter((g) => why.has(g)).map((g) => [g, why.get(g)]));
}

/** Problems: a spec on disk in no group, a grouped spec that does not exist, a spec in two groups. */
export function checkGroups(specsOnDisk) {
  const problems = [];
  const seen = new Map();
  for (const [g, specs] of Object.entries(GROUPS)) for (const s of specs) {
    if (seen.has(s)) problems.push(`${s} is in ${seen.get(s)} and ${g}`);
    seen.set(s, g);
    if (!specsOnDisk.includes(s)) problems.push(`${s} (group ${g}) has no tests/e2e/${s}.spec.ts`);
  }
  for (const s of specsOnDisk) if (!seen.has(s)) problems.push(`tests/e2e/${s}.spec.ts is in no group: add it to GROUPS in scripts/lib/test-groups.mjs`);
  return problems;
}
