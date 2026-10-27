import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

/** The colour picker as a package (src/colour-picker/README.md): its demo page, built on its own, with every option on. No canvast code is loaded. */
// the picker's demo page: the snapshot's own copy (`npm run test:snap`, CANVAST_PICKER_DIR), else `dist-picker/` (`npm run build:picker`)
const DEMO = `file://${process.env["CANVAST_PICKER_DIR"] ? resolve(process.env["CANVAST_PICKER_DIR"], "demo.html") : fileURLToPath(new URL("../../dist-picker/demo.html", import.meta.url))}`;

test("colour picker package: four layouts, plane, transparency, text formats, contrast, harmonies, and a drag stays fast", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(DEMO);
  const cp = page.locator("#host .cp");
  const hex = cp.locator("[data-hex]");
  const visible = async (sel: string) => cp.locator(sel).isVisible();

  // Each layout shows its own parts.
  const parts: Record<string, [boolean, boolean, boolean, boolean]> = {
    // [ring and box, plane, slider rows, number strip]
    wheel: [true, false, false, true],
    plane: [false, true, true, true],
    sliders: [false, false, true, false],
    mixer: [true, false, true, false],
  };
  for (const [view, want] of Object.entries(parts)) {
    await cp.locator("[data-view-select]").selectOption(view);
    expect([await visible(".cp-wheel"), await visible(".cp-plane"), await visible(".cp-fields"), await visible(".cp-nums")], view).toEqual(want);
  }

  // The plane: a press in it sets saturation and value; the hue bar above it sets the hue.
  await cp.locator("[data-view-select]").selectOption("plane");
  const before = await hex.inputValue();
  const plane = (await cp.locator(".cp-plane").boundingBox())!;
  await page.mouse.move(plane.x + plane.width * 0.2, plane.y + plane.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(plane.x + plane.width * 0.85, plane.y + plane.height * 0.15, { steps: 5 });
  await page.mouse.up();
  const picked = await hex.inputValue();
  expect(picked).not.toBe(before);
  await cp.locator('[data-slider="0"]').focus();
  await page.keyboard.press("PageUp");
  expect(await hex.inputValue()).not.toBe(picked);

  // Transparency: the opacity slider adds two digits; typing rgb() with a slash takes the alpha; the format switch rewrites the text.
  await expect(cp.locator(".cp-alpha")).toBeVisible();
  await cp.locator("[data-alpha-slider]").focus();
  await page.keyboard.press("PageDown");
  expect(await hex.inputValue()).toMatch(/^[0-9A-F]{6}E6$/); // 90% is 0xE6
  await hex.fill("rgb(255 0 0 / 50%)");
  await hex.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { picker: { value: string } }).picker.value)).toBe("#ff000080");
  await cp.locator("[data-format]").selectOption("rgb");
  expect(await hex.inputValue()).toMatch(/^rgb\(255 0 0 \/ 0\.5\)$/);
  await cp.locator("[data-format]").selectOption("oklch");
  expect(await hex.inputValue()).toMatch(/^oklch\(0\.628 0\.258 29\.2 \/ 0\.5\)$/);
  await hex.fill("#2563eb");
  await hex.press("Enter");
  expect(await hex.inputValue()).toMatch(/^oklch\(/);

  // Contrast against white, and the harmonies that follow the colour.
  await expect(cp.locator("[data-contrast]")).toContainText(/Contrast with #ffffff: \d+(\.\d+)?:1/);
  const swatches = cp.locator("[data-harmony] .cp-swatch");
  await expect(swatches).toHaveCount(2 + 3); // complement: the colour and one; triad: the colour and two
  const first = await swatches.nth(1).getAttribute("data-c");
  await swatches.nth(1).click();
  expect(await page.evaluate(() => (window as unknown as { picker: { value: string } }).picker.value)).toBe(`${first}80`); // an opaque swatch keeps the current opacity (50%)

  // Speed: 120 hue steps (each repaints the box, the tracks and the thumbs) finish in a moment; this is a regression guard, not a benchmark.
  await cp.locator("[data-view-select]").selectOption("mixer");
  const ms = await page.evaluate(async () => {
    const s = document.querySelector<HTMLInputElement>('.cp [data-slider="0"]')!;
    const t = performance.now();
    for (let i = 0; i < 120; i++) {
      s.value = String((i * 3) % 360);
      s.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return performance.now() - t;
  });
  expect(ms, `120 hue steps took ${Math.round(ms)} ms`).toBeLessThan(120 * 50); // 50 ms a step: three frames; typical is one frame

  // The custom element: attributes in, events out, inside a shadow root.
  const seen = await page.evaluate(async () => {
    const CP = (window as unknown as { ColourPicker: { defineColourPickerElement(): void } }).ColourPicker;
    CP.defineColourPickerElement();
    const el = document.createElement("colour-picker") as HTMLElement & { value: string };
    el.setAttribute("value", "#112233");
    el.setAttribute("view", "sliders");
    document.body.append(el);
    const got: string[] = [];
    el.addEventListener("input", (e) => got.push((e as unknown as CustomEvent).detail.value));
    const s = el.shadowRoot!.querySelector<HTMLInputElement>('[data-slider="1"]')!;
    s.value = "20";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    el.value = "#ff0000";
    return { got, value: el.value, hasShadow: !!el.shadowRoot!.querySelector(".cp"), styled: getComputedStyle(el.shadowRoot!.querySelector(".cp")!).display };
  });
  expect(seen.hasShadow).toBe(true);
  expect(seen.styled).toBe("flex");
  expect(seen.got.length).toBe(1);
  expect(seen.value).toBe("#ff0000");
  expect(errors).toEqual([]);
});

test("gradient editor in the package: stops by bar, handle, field and key; kinds; angle and centre; the stop's own colour picker", async ({ page }) => {
  await page.goto(DEMO);
  type G = { type: string; angle: number; cx: number; r: number; stops: Array<{ offset: number; colour: string }> };
  const value = () => page.evaluate(() => (window as unknown as { gradient: { value: G } }).gradient.value);
  const ed = page.locator(".cg");
  const bar = ed.locator("[data-bar]");
  const box = (await bar.boundingBox())!;
  expect((await value()).stops).toHaveLength(2);

  // the numbers of the editor sit in one column, as wide as three digits, at the right edge (the same as the numbers of the sliders)
  const posBox = (await ed.locator("[data-pos]").boundingBox())!;
  const angBox = (await ed.locator("[data-angle]").boundingBox())!;
  expect(Math.abs(posBox.x + posBox.width - (angBox.x + angBox.width)), "Position and Angle end at the same place").toBeLessThan(1.5);
  expect(posBox.width, "a box for three digits, not the whole row").toBeLessThan(80);

  // a click on the bar adds a stop there, in the colour the gradient has at that offset, and selects it
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  let v = await value();
  expect(v.stops).toHaveLength(3);
  expect(v.stops[1]!.offset).toBeCloseTo(0.5, 1);
  expect(v.stops[1]!.colour).toMatch(/^#2563eb[0-9a-f]{2}$/); // half way to nothing
  await expect(ed.locator(".cg-stop.is-on")).toHaveCount(1);

  // drag its handle: the stops stay in order
  const h = (await ed.locator(".cg-stop").nth(1).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  v = await value();
  expect(v.stops.map((s) => Math.round(s.offset * 10) / 10)).toEqual([0, 0.8, 1]);

  // the position field, and a stop dragged past its neighbour
  await ed.locator("[data-pos]").fill("30");
  expect((await value()).stops[1]!.offset).toBeCloseTo(0.3, 6);

  // the selected stop's colour: its own picker (typing an opaque 8-digit hex sets colour and opacity)
  await ed.locator("[data-hex]").fill("ff0000ff");
  await ed.locator("[data-hex]").press("Enter");
  expect((await value()).stops[1]!.colour).toBe("#ff0000");

  // reverse, angle, kind
  await ed.locator("[data-reverse]").click();
  v = await value();
  expect(v.stops.at(-1)!.colour).toBe("#2563eb");
  expect(v.stops[1]!.offset).toBeCloseTo(0.7, 6);
  await ed.locator("[data-angle]").fill("45");
  expect((await value()).angle).toBe(45);
  await ed.locator('[data-gtype="radial"]').click();
  expect((await value()).type).toBe("radial");
  await expect(ed.locator(".cg-radial")).toBeVisible();
  await expect(ed.locator(".cg-linear")).toBeHidden();
  await ed.locator("[data-cx]").fill("25");
  expect((await value()).cx).toBeCloseTo(0.25, 6);
  await ed.locator("[data-r]").fill("80");
  expect((await value()).r).toBeCloseTo(0.8, 6);

  // keys: Delete removes the stop with the focus, never below two
  await ed.locator(".cg-stop").nth(1).focus();
  await page.keyboard.press("Delete");
  expect((await value()).stops).toHaveLength(2);
  await ed.locator(".cg-stop").nth(0).focus();
  await page.keyboard.press("Delete");
  expect((await value()).stops).toHaveLength(2);
  await page.keyboard.press("ArrowRight");
  expect((await value()).stops[0]!.offset).toBeCloseTo(0.01, 6);
  expect(await page.evaluate(() => (window as unknown as { gradientEvents: number }).gradientEvents)).toBeGreaterThan(8);
  // Randomize: every stop gets a new, fully opaque colour; the ends are at 0 and 100 %
  await ed.locator("[data-random]").click();
  const r = await value();
  expect(r.stops.every((s) => /^#[0-9a-f]{6}$/.test(s.colour)), "no transparency in a random gradient").toBe(true);
  expect([r.stops[0]!.offset, r.stops[r.stops.length - 1]!.offset]).toEqual([0, 1]);
});

test("colour picker package: the opacity number and the channel numbers scrub by dragging, and Shift lands on round steps", async ({ page }) => {
  await page.goto(DEMO);
  const cp = page.locator("#host .cp");
  await expect(cp.locator(".cp-alpha")).toBeVisible();
  await cp.locator("[data-view-select]").selectOption("sliders");
  for (const sel of ["[data-alpha-num]", '[data-num="1"]']) {
    const f = cp.locator(sel);
    const r = (await f.boundingBox())!;
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const before = Number(await f.inputValue());
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(x - 30, y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const after = Number(await f.inputValue());
    expect(after, `${sel} follows the drag`).not.toBe(before);
    expect(after % 5, `${sel} is on a step of 5`).toBe(0);
  }
});

test("colour picker package: light and dark follow the system, and a theme (option, attribute on it or around it, the tag) chooses whatever the system says", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(DEMO);
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector("#host .cp")!).getPropertyValue("--cp-bg").trim());
  const LIGHT = "#ffffff", DARK = "#1d2126";
  await page.emulateMedia({ colorScheme: "light" });
  expect(await bg()).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await bg()).toBe(DARK);
  // A theme on the picker, or on anything around it, wins over the system either way; the browser's own controls follow (color-scheme).
  await page.evaluate(() => document.querySelector("#host .cp")!.setAttribute("data-cp-theme", "light"));
  expect(await bg()).toBe(LIGHT);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("#host .cp")!).colorScheme)).toBe("light");
  await page.evaluate(() => { document.querySelector("#host .cp")!.removeAttribute("data-cp-theme"); document.body.setAttribute("data-cp-theme", "light"); });
  expect(await bg()).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.body.setAttribute("data-cp-theme", "dark"));
  expect(await bg()).toBe(DARK);
  // A host's own rule still wins (the defaults have no specificity).
  await page.addStyleTag({ content: ".cp { --cp-bg: #123456; }" });
  expect(await bg()).toBe("#123456");
  // The option, the gradient editor, and the tag (in a shadow root, which a page's selectors cannot see into).
  const result = await page.evaluate(() => {
    const CP = (window as unknown as { ColourPicker: { createColourPicker(o: object): { el: HTMLElement }; createGradientEditor(o: object): { el: HTMLElement }; defineColourPickerElement(): void } }).ColourPicker;
    document.body.removeAttribute("data-cp-theme");
    document.querySelectorAll("style").forEach((s) => { if (s.textContent?.includes("#123456")) s.remove(); });
    const read = (el: Element): string => getComputedStyle(el).getPropertyValue("--cp-bg").trim();
    const picker = CP.createColourPicker({ theme: "dark" });
    const editor = CP.createGradientEditor({ theme: "dark" });
    document.body.append(picker.el, editor.el);
    CP.defineColourPickerElement();
    const tag = document.createElement("colour-picker");
    tag.setAttribute("theme", "dark");
    document.body.append(tag);
    const inner = (): Element => tag.shadowRoot!.querySelector(".cp")!;
    const out = { option: read(picker.el), editor: read(editor.el.querySelector(".cp:not(.cg)") ?? editor.el), tag: read(inner()), tagLight: "" };
    tag.setAttribute("theme", "light");
    out.tagLight = read(inner());
    return out;
  });
  await page.emulateMedia({ colorScheme: "light" });
  expect(result).toEqual({ option: DARK, editor: DARK, tag: DARK, tagLight: LIGHT });
  expect(errors).toEqual([]);
});

test("colour picker package: the demo page has an Auto, Light and Dark switch that drives the picker, the gradient editor and the browser's own controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(DEMO);
  const state = () =>
    page.evaluate(() => {
      const cp = document.querySelector("#host .cp")!;
      const ge = document.querySelector("#ghost .cp")!;
      return { picker: getComputedStyle(cp).getPropertyValue("--cp-bg").trim(), scheme: getComputedStyle(cp).colorScheme, gradient: getComputedStyle(ge).getPropertyValue("--cp-bg").trim(), page: getComputedStyle(document.body).backgroundColor };
    });
  const DARK = { picker: "#1d2126", scheme: "dark", gradient: "#1d2126", page: "rgb(20, 23, 26)" };
  const LIGHT = { picker: "#ffffff", scheme: "light", gradient: "#ffffff", page: "rgb(238, 241, 243)" };
  expect(await state(), "Auto follows the system: dark").toEqual(DARK);
  await page.getByRole("button", { name: "Light" }).click();
  expect(await state()).toEqual(LIGHT);
  await expect(page.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Dark" }).click();
  expect(await state(), "Dark whatever the system says").toEqual(DARK);
  await page.getByRole("button", { name: "Auto" }).click();
  expect(await state(), "Auto follows the system again: light (no colour-scheme is set, so the browser's own controls are light anyway)").toEqual({ ...LIGHT, scheme: "normal" });
  expect(errors).toEqual([]);
});
