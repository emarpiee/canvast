import type { Session } from "../app/session";

/**
 * Workspace › Board › Canvas navigator (top-left) and the read-only banner.
 * The breadcrumb button opens a menu listing boards and their canvases with
 * create and rename actions. Everything is a button or input, so it is
 * keyboard-usable; Escape closes the menu.
 */
export function mountNavigator(root: HTMLElement, session: Session): void {
  root.innerHTML = `
    <div class="nav">
      <button type="button" class="nav-crumb" data-testid="workspace-nav" aria-haspopup="true" aria-expanded="false"></button>
      <div class="nav-menu" role="menu" data-testid="workspace-menu" hidden></div>
    </div>
    <div class="readonly-banner" role="alert" data-testid="readonly-banner" hidden>
      <span>Read-only — this workspace is open for editing in another tab.</span>
      <button type="button" data-action="take-over">Take over</button>
    </div>`;
  const crumb = root.querySelector<HTMLButtonElement>(".nav-crumb")!;
  const menu = root.querySelector<HTMLElement>(".nav-menu")!;
  const banner = root.querySelector<HTMLElement>(".readonly-banner")!;
  let renaming: { kind: "board" | "canvas"; id: string } | null = null;

  const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const renderMenu = (): void => {
    const tree = session.tree;
    if (!tree) {
      menu.innerHTML = `<p class="nav-empty">Storage unavailable: one unsaved canvas.</p>`;
      return;
    }
    const cur = session.current;
    const label = (kind: "board" | "canvas", id: string, name: string, extra: string): string =>
      renaming && renaming.kind === kind && renaming.id === id
        ? `<input class="nav-rename" data-rename="${kind}" data-id="${id}" value="${esc(name)}" aria-label="New ${kind} name">`
        : extra;
    menu.innerHTML =
      tree.boards
        .map(({ board, canvases }) => {
          const head = label(
            "board",
            board.id,
            board.name,
            `<span class="nav-board-name">${esc(board.name)}</span>
             <button type="button" class="nav-mini" data-action="rename-board" data-id="${board.id}" aria-label="Rename board ${esc(board.name)}" title="Rename board">Rename</button>`,
          );
          const items = canvases
            .map((c) => {
              const active = cur?.canvasId === c.id;
              return `<li class="nav-canvas-row">${label(
                "canvas",
                c.id,
                c.name,
                `<button type="button" role="menuitemradio" aria-checked="${active}" class="nav-canvas${active ? " is-active" : ""}" data-action="open" data-id="${c.id}">${esc(c.name)}<span class="nav-count">${c.objectCount}</span></button>
                 <button type="button" class="nav-mini" data-action="rename-canvas" data-id="${c.id}" aria-label="Rename canvas ${esc(c.name)}" title="Rename canvas">Rename</button>`,
              )}</li>`;
            })
            .join("");
          return `<section class="nav-board" aria-label="Board ${esc(board.name)}">
            <div class="nav-board-head">${head}</div>
            <ul class="nav-canvases">${items}</ul>
            <button type="button" class="nav-add" data-action="new-canvas" data-id="${board.id}">+ Canvas</button>
          </section>`;
        })
        .join("") + `<button type="button" class="nav-add nav-add-board" data-action="new-board">+ Board</button>`;
    const input = menu.querySelector<HTMLInputElement>(".nav-rename");
    if (input) {
      input.focus();
      input.select();
    }
  };

  const render = (): void => {
    const tree = session.tree;
    const cur = session.current;
    const entry = tree?.boards.find((b) => b.board.id === cur?.boardId);
    const canvas = entry?.canvases.find((c) => c.id === cur?.canvasId);
    crumb.textContent = entry && canvas ? `${entry.board.name} › ${canvas.name}` : "Canvas";
    crumb.title = tree ? `${tree.workspace.displayName} › ${crumb.textContent}` : "";
    banner.hidden = !session.readOnly;
    if (!menu.hidden) renderMenu();
  };

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    crumb.setAttribute("aria-expanded", String(open));
    if (open) renderMenu();
    else renaming = null;
  };

  crumb.addEventListener("click", () => setOpen(menu.hidden === true));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden && !renaming) {
      setOpen(false);
      crumb.focus();
      e.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !root.contains(e.target as Node)) setOpen(false);
  });

  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const id = b.dataset["id"] ?? "";
    switch (b.dataset["action"]) {
      case "open":
        void session.openCanvas(id).then(() => setOpen(false));
        break;
      case "new-board":
        void session.newBoard().then(() => setOpen(false));
        break;
      case "new-canvas":
        void session.newCanvas(id).then(() => setOpen(false));
        break;
      case "rename-board":
        renaming = { kind: "board", id };
        renderMenu();
        break;
      case "rename-canvas":
        renaming = { kind: "canvas", id };
        renderMenu();
        break;
    }
  });
  menu.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("nav-rename")) return;
    if (e.key === "Enter") {
      const { rename, id } = input.dataset;
      renaming = null;
      if (rename === "board") void session.renameBoard(id!, input.value);
      else void session.renameCanvas(id!, input.value);
      e.preventDefault();
    } else if (e.key === "Escape") {
      renaming = null;
      renderMenu();
      e.preventDefault();
      e.stopPropagation();
    }
  });
  banner.querySelector("button")!.addEventListener("click", () => void session.takeOver());

  session.subscribe(render);
  render();
}
