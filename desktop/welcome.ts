// The desktop app's first page, when there is no workspace to open (a first start, or the last one's folder gone): a window of its
// own made of the app's parts, its stylesheet, logo, icons and the lock screen's look (one card, the brand above), so canvast's first
// sight is canvast and not a system message box. It runs no script: each choice is a link to `#<choice>`, which the main process reads
// as the page moves to it (`did-navigate-in-page`).
import styles from "../src/styles.css";
import { logoSvg } from "../src/ui/brand";
import { esc } from "../src/ui/format";
import { ICONS } from "../src/ui/icons";

/** What the welcome page offers: the recent workspaces that are still there, and the folder of the last one if it is gone. */
export interface WelcomeChoices {
  recent: ReadonlyArray<{ name: string; path: string }>;
  missing: string | null;
}

/** The choice a link names: `recent-<n>`, `open`, `new` or `quit`. */
export type WelcomeChoice = { kind: "recent"; index: number } | { kind: "open" } | { kind: "new" } | { kind: "quit" };

export function welcomeChoiceOf(hash: string): WelcomeChoice | null {
  const h = hash.replace(/^#/, "");
  const r = /^recent-(\d)$/.exec(h);
  if (r) return { kind: "recent", index: Number(r[1]) };
  return h === "open" || h === "new" || h === "quit" ? { kind: h } : null;
}

export function welcomeHtml(o: WelcomeChoices): string {
  const gone = o.missing ? o.missing.split(/[\\/]/).filter(Boolean).pop() ?? o.missing : null;
  const title = gone ? `The workspace folder “${esc(gone)}” is not there any more` : "Choose a workspace";
  const text = gone
    ? `It was at ${esc(o.missing!)}. It may have been moved or deleted (a deleted folder may still be in the system trash).`
    : "A workspace is a folder: your boards, canvases and library are files in it.";
  const recent = o.recent.map((w, i) => `<a class="assets-btn welcome-recent" href="#recent-${i}" data-testid="welcome-recent" title="${esc(w.path)}">${ICONS.folderOpen}<span>${esc(w.name)}</span></a>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>canvast</title><style>${styles}</style><style>
/* (the page around the app's lock-screen card: centred on the app's background; links that look like its buttons) */
body { display: flex; min-height: 100vh; margin: 0; background: var(--theme-bg); }
dialog.lock-screen { position: static; margin: auto; }
.welcome-actions { display: grid; gap: var(--s-4); }
.welcome-actions a, .lock-other a { text-decoration: none; }
.lock-other .welcome-recent span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body>
<dialog open class="confirm lock-screen" aria-labelledby="welcome-title" data-testid="welcome">
<div class="lock-brand"><span class="lock-logo">${logoSvg()}</span><span class="lock-name">canvast</span></div>
<h2 id="welcome-title">${title}</h2>
<p class="lock-text">${text}</p>
<div class="welcome-actions">
<a class="assets-btn is-primary" href="#new" data-testid="welcome-new">${ICONS.folderPlus}<span>New workspace…</span></a>
<a class="assets-btn" href="#open" data-testid="welcome-open">${ICONS.folderOpen}<span>Open a folder…</span></a>
</div>
${recent ? `<div class="lock-other" aria-label="Recent workspaces">${recent}</div>` : ""}
<div class="lock-other"><a class="assets-btn" href="#quit" data-testid="welcome-quit">${ICONS.x}<span>Quit</span></a></div>
</dialog></body></html>`;
}
