// Back and forward through the files opened in one place, as notes apps have it (Navigate back, Navigate forward): the Library's viewer,
// and the file panel or window on a canvas. One history per place (for this session), one pair of buttons and one pair of commands for
// all: the commands act on the place used last. Mouse back and forward buttons, and Alt+Left / Alt+Right outside the text, too.
import { commands, pressCommand } from "../commands/registry";
import { ICONS } from "./icons";

/** What a place does with its history: show a file without it being a new step. */
export interface NavPlace {
  /** Show `hash` (a step back or forward); false when it could not be shown (it is then skipped). */
  show(hash: string): Promise<boolean>;
  /** Where its buttons are (drawn again as the history moves) and where its keys and mouse buttons are heard. */
  root(): HTMLElement | null;
}

/** One place's files: those before the one shown, and those after it once gone back. */
export class FileHistory {
  private past: string[] = [];
  private next: string[] = [];
  private now: string | null = null;
  private moving = false;
  constructor(readonly id: string, private readonly place: NavPlace) {
    places.set(id, this);
  }
  /** A file shown in this place (not by back or forward): a new step, and nothing to go forward to. */
  visit(hash: string): void {
    if (this.moving || hash === this.now) return void this.sync();
    if (this.now) this.past.push(this.now);
    this.now = hash;
    this.next = [];
    this.sync();
  }
  get canBack(): boolean {
    return this.past.length > 0;
  }
  get canForward(): boolean {
    return this.next.length > 0;
  }
  async go(dir: -1 | 1): Promise<void> {
    const from = dir < 0 ? this.past : this.next, to = dir < 0 ? this.next : this.past;
    while (from.length) {
      const hash = from.pop()!;
      this.moving = true;
      const ok = await this.place.show(hash).catch(() => false).finally(() => void (this.moving = false));
      if (!ok) continue; // (gone from the library meanwhile: the next one)
      if (this.now) to.push(this.now);
      this.now = hash;
      break;
    }
    this.sync();
  }
  /** Its buttons as the history is now: one that leads nowhere is dimmed (its tooltip still says what it does). */
  sync(): void {
    const root = this.place.root();
    if (!root) return;
    for (const b of root.querySelectorAll<HTMLButtonElement>(`[data-nav="${this.id}"]`)) b.disabled = b.dataset["dir"] === "back" ? !this.canBack : !this.canForward;
  }
  /** Its keys and mouse buttons, heard on `el`: the mouse's back and forward buttons, and Alt+Left / Alt+Right outside the text. */
  listen(el: HTMLElement): void {
    // view-state: (which place the commands act on: the one used last)
    el.addEventListener("pointerdown", () => void (last = this.id), true);
    el.addEventListener("focusin", () => void (last = this.id));
    // commands: file.back, file.forward (the mouse's back and forward buttons)
    el.addEventListener("mouseup", (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      pressCommand(e.button === 3 ? "file.back" : "file.forward", { place: this.id }, "key");
    });
    // commands: file.back, file.forward (Alt+Left and Alt+Right, but in the text, where they move the cursor by words)
    el.addEventListener("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      e.stopPropagation();
      pressCommand(e.key === "ArrowLeft" ? "file.back" : "file.forward", { place: this.id }, "key");
    });
  }
}

const places = new Map<string, FileHistory>();
let last = "";

/** The two buttons of a place's history, for its header (wired by `wireNav`). */
export function navButtonsHtml(place: string): string {
  return `<span class="nav-pair" role="group" aria-label="History"><button type="button" class="layer-btn" data-nav="${place}" data-dir="back" data-command="file.back" aria-label="Navigate back" title="Navigate back (Alt+Left)" disabled>${ICONS.arrowLeft}</button><button type="button" class="layer-btn" data-nav="${place}" data-dir="forward" data-command="file.forward" aria-label="Navigate forward" title="Navigate forward (Alt+Right)" disabled>${ICONS.arrowRight}</button></span>`;
}
/** The buttons of `history` inside `root` run its commands. */
export function wireNav(root: HTMLElement, history: FileHistory): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>(`[data-nav="${history.id}"]`))
    b.addEventListener("click", () => void pressCommand(b.dataset["dir"] === "back" ? "file.back" : "file.forward", { place: history.id }));
  history.sync();
}

const placeOf = (o: Readonly<Record<string, unknown>>): FileHistory | undefined => places.get(typeof o["place"] === "string" ? (o["place"] as string) : last) ?? [...places.values()][0];
commands.setProvider("file-history", () =>
  (["back", "forward"] as const).map((dir) => ({
    id: `file.${dir}`,
    title: dir === "back" ? "Navigate back" : "Navigate forward",
    group: "Files",
    hint: dir === "back" ? "The file shown before, in the viewer or panel used last" : "The file gone back from",
    icon: dir === "back" ? ICONS.arrowLeft : ICONS.arrowRight,
    keys: dir === "back" ? "Alt+Left" : "Alt+Right",
    risk: "read" as const,
    options: [{ name: "place", type: "choice" as const, choices: ["viewer", "panel"], doc: "The Library's viewer or the canvas's file panel (default: the one used last)" }],
    why: () => {
      const h = placeOf({});
      return !h ? "No file is open." : (dir === "back" ? h.canBack : h.canForward) ? null : dir === "back" ? "Nothing to go back to." : "Nothing to go forward to.";
    },
    exec: (o: Readonly<Record<string, unknown>>) => {
      const h = placeOf(o);
      if (h) void h.go(dir === "back" ? -1 : 1);
      return { ok: true as const };
    },
  })),
);
