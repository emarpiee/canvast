import { ICONS } from "./icons";
import { esc } from "./format";
import { pressCommand } from "../commands/registry";

/** A button of the ribbon: the command it runs, its icon and its name (with its key). */
interface RibbonButton {
  command: string;
  icon: string;
  title: string;
  testid: string;
}

const TOP: readonly RibbonButton[] = [
  { command: "go.library", icon: ICONS.images, title: "Library", testid: "ribbon-library" },
  { command: "workspace.newCanvas", icon: ICONS.infinity, title: "New canvas", testid: "ribbon-new-canvas" },
  { command: "library.newNote", icon: ICONS.notebookPen, title: "New note", testid: "ribbon-new-note" },
  { command: "find.palette", icon: ICONS.findCommand, title: "Command palette (Ctrl+K)", testid: "ribbon-palette" },
];
const BOTTOM: readonly RibbonButton[] = [{ command: "find.help", icon: ICONS.circleHelp, title: "Shortcuts (?)", testid: "ribbon-help" }];

const html = (b: RibbonButton): string =>
  `<button type="button" class="ribbon-btn" data-command="${b.command}" data-ribbon data-testid="${b.testid}" aria-label="${esc(b.title)}" title="${esc(b.title)}">${b.icon}</button>`;

/**
 * The ribbon (B39): the narrow column at the window's left edge with what is the app's, not a view's: the Library, a new canvas or note, the
 * command palette and the Pins window at the top; help and Settings at the bottom. The Pins and Settings buttons are the app's own (moved here
 * into `[data-ribbon-slot]`, with their handlers); the others run their command.
 */
export function mountRibbon(el: HTMLElement): void {
  el.innerHTML = `
    <div class="ribbon-group" data-cmd-group="Ribbon">${TOP.map(html).join("")}<span class="ribbon-slot" data-ribbon-slot="top"></span></div>
    <div class="ribbon-group" data-cmd-group="Ribbon">${BOTTOM.map(html).join("")}<span class="ribbon-slot" data-ribbon-slot="settings"></span></div>`;
  // commands: go.library, workspace.newCanvas, library.newNote, find.palette, find.help
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ribbon][data-command]");
    if (b) void pressCommand(b.dataset["command"]!);
  });
}
