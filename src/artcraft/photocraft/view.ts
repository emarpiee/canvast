import { panelHtml } from "../../ui/panel";

/**
 * PhotoCraft's view (artcraft/photocraft/app.ts), one of the app's views beside Canvas, Library and Settings: under the top bar, with the
 * shared panel's header (its name, and the button that closes PhotoCraft) and a line under it while it starts or after it saved. Its
 * frame fills the rest, and stays while another view is shown; its keys are its own while it has the focus.
 */
export interface PhotoCraftView {
  /** Where its frame goes. */
  readonly body: HTMLElement;
  show(): void;
  hide(): void;
  /** A line under the header that stays ("" hides it). */
  status(text: string): void;
  /** A line under the header for a few seconds (what happened to a file it saved). */
  note(text: string): void;
}

export function mountPhotoCraftView(onClose: () => void): PhotoCraftView {
  const root = document.createElement("section");
  root.className = "layers-panel photocraft-view";
  root.setAttribute("aria-label", "PhotoCraft");
  root.dataset["testid"] = "photocraft-view";
  root.hidden = true;
  root.innerHTML = panelHtml({ title: "PhotoCraft", sub: `<p class="photocraft-status" role="status" aria-live="polite"></p>`, body: "" });
  document.body.append(root);
  const close = root.querySelector<HTMLButtonElement>("[data-close]")!;
  close.setAttribute("aria-label", "Close PhotoCraft (it asks first when something is not saved)");
  close.title = "Close PhotoCraft";
  close.addEventListener("click", onClose);
  const line = root.querySelector<HTMLElement>(".photocraft-status")!;
  const sub = root.querySelector<HTMLElement>(".panel-sub")!;
  let lasting = "";
  let timer = 0;
  const put = (text: string): void => {
    line.textContent = text;
    sub.hidden = !text;
  };
  put("");
  return {
    body: root.querySelector<HTMLElement>(".panel-body")!,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    status(text) {
      lasting = text;
      window.clearTimeout(timer);
      put(text);
    },
    note(text) {
      window.clearTimeout(timer);
      put(text);
      timer = window.setTimeout(() => put(lasting), 8000);
    },
  };
}
