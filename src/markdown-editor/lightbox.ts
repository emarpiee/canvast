// A picture full size over the page: fitted to the window, a click shows it at its own size and a drag pans it; the arrows go to the
// note's other pictures; Escape, the close button or a click beside it closes.
export interface LightboxPicture {
  src: string;
  alt: string;
}

export function openLightbox(pictures: readonly LightboxPicture[], index: number, closeLabel: string): void {
  if (!pictures.length) return;
  const restore = document.activeElement as HTMLElement | null;
  const box = document.createElement("div");
  box.className = "me-lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.tabIndex = -1;
  const img = document.createElement("img");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "me-btn me-lightbox-close";
  close.setAttribute("aria-label", closeLabel);
  close.textContent = "×";
  box.append(img, close);
  let at = index, full = false, x = 0, y = 0;
  const place = (): void => {
    img.classList.toggle("is-full", full);
    img.style.transform = full ? `translate(${x}px, ${y}px)` : "";
  };
  const show = (i: number): void => {
    at = (i + pictures.length) % pictures.length;
    img.src = pictures[at]!.src;
    img.alt = pictures[at]!.alt;
    box.setAttribute("aria-label", pictures[at]!.alt);
    full = false;
    x = y = 0;
    place();
  };
  const done = (): void => {
    box.remove();
    document.removeEventListener("keydown", keys, true);
    restore?.focus?.();
  };
  const keys = (e: KeyboardEvent): void => {
    if (e.key === "Escape") done();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") show(at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") show(at - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // view-state: (closing the full-size view changes nothing in the note)
  close.addEventListener("click", done);
  // view-state: (a press beside the picture closes; on it, a click toggles its own size and a drag pans)
  box.addEventListener("pointerdown", (e) => {
    if (e.target === close) return;
    if (e.target !== img) return void done();
    e.preventDefault();
    const x0 = e.clientX - x, y0 = e.clientY - y, sx = e.clientX, sy = e.clientY;
    let moved = false;
    img.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      if (!full) return;
      moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3;
      x = ev.clientX - x0;
      y = ev.clientY - y0;
      place();
    };
    img.addEventListener("pointermove", move);
    img.addEventListener("pointerup", () => {
      img.removeEventListener("pointermove", move);
      if (moved) return;
      full = !full;
      x = y = 0;
      place();
    }, { once: true });
  });
  document.addEventListener("keydown", keys, true);
  document.body.append(box);
  show(index);
  box.focus();
}
