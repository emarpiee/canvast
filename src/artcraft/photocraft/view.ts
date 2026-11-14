import { panelHtml } from "../../ui/panel";

/**
 * The view PhotoCraft runs in (artcraft/photocraft/app.ts): over the whole app, under the window's own row, with the shared panel's header (its
 * name and the button that closes it) and a status line while it starts. Its frame fills the rest; its keys are its own while it has the
 * focus.
 */
export interface PhotoCraftView {
  /** Where its frame goes. */
  readonly body: HTMLElement;
  show(): void;
  hide(): void;
  /** A line under the header ("" hides it). */
  status(text: string): void;
}

export function mountPhotoCraftView(onClose: () => void): PhotoCraftView {
  const root = document.createElement("section");
  root.className = "layers-panel photocraft-view";
  root.setAttribute("aria-label", "PhotoCraft");
  root.dataset["testid"] = "photocraft-view";
  root.hidden = true;
  root.innerHTML = panelHtml({ title: "PhotoCraft", sub: `<p class="photocraft-status" role="status" aria-live="polite" hidden></p>`, body: "" });
  document.body.append(root);
  root.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", onClose);
  const status = root.querySelector<HTMLElement>(".photocraft-status")!;
  const sub = root.querySelector<HTMLElement>(".panel-sub")!;
  sub.hidden = true;
  return {
    body: root.querySelector<HTMLElement>(".panel-body")!,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    status(text) {
      status.textContent = text;
      status.hidden = sub.hidden = !text;
    },
  };
}
