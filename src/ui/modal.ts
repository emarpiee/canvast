/**
 * The one way a modal dialog is made: a native `<dialog>` (focus kept inside, the rest of the page inert, Escape closes), added to the page when it
 * is made and gone from it when it closes. `locked` keeps it open on Escape (a lock screen, a busy screen). A dialog brings only its contents.
 */
export interface ModalOptions {
  className: string;
  testid: string;
  /** The id of the element in `html` that names it. */
  titleId: string;
  html: string;
  locked?: boolean;
}

export function makeModal(o: ModalOptions): HTMLDialogElement {
  const dlg = document.createElement("dialog");
  dlg.className = o.className;
  dlg.dataset["testid"] = o.testid;
  dlg.setAttribute("aria-labelledby", o.titleId);
  dlg.innerHTML = o.html;
  if (o.locked) {
    dlg.dataset["locked"] = "";
    dlg.addEventListener("cancel", (e) => e.preventDefault());
  }
  document.body.appendChild(dlg);
  return dlg;
}

const watchers = new Set<() => void>();
/** Told when a modal has opened or closed: what must stay above every modal moves into the newest (the window's row). */
export const onModalChange = (fn: () => void): void => void watchers.add(fn);
const modalChanged = (): void => watchers.forEach((fn) => fn());

/** Show it; `closed` runs once it has closed and left the page. */
export function showModal(dlg: HTMLDialogElement, closed?: () => void): void {
  dlg.addEventListener("close", () => {
    dlg.remove();
    modalChanged();
    closed?.();
  });
  dlg.showModal();
  modalChanged();
}
