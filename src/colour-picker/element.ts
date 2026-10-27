/**
 * `<colour-picker>`: the picker as a custom element, for plain HTML, React, Vue or anything else that can write a tag. The picker lives
 * in a shadow root, so a page's CSS cannot reach into it; the `--cp-*` custom properties still pass through, so it is themed the same way.
 *
 *   <colour-picker value="#2563eb" model="okhsv" view="mixer" alpha contrast="#ffffff"></colour-picker>
 *   el.addEventListener("input", (e) => e.detail.value);    // every step
 *   el.addEventListener("change", (e) => e.detail.value);   // when a gesture ends
 *   el.value = "#ff0000";                                    // set from outside
 *
 * Attributes: value, model (okhsl | okhsv | okhcl), view (wheel | plane | sliders | mixer), format (hex | rgb | oklch), alpha, contrast,
 * size, theme (auto | light | dark), eyedropper="false". Call `defineColourPickerElement()` once (the name can be changed) before the tag is used.
 */
import { createColourPicker, VIEWS, type ColourPicker, type View } from "./picker";
import { MODELS, TEXT_FORMATS, type Model, type TextFormat } from "./colour";
import { PICKER_CSS } from "./style";

export function defineColourPickerElement(name = "colour-picker"): void {
  if (typeof customElements === "undefined" || customElements.get(name)) return;
  customElements.define(
    name,
    class extends HTMLElement {
      static observedAttributes = ["value", "model", "view", "theme"];
      private picker: ColourPicker | null = null;

      connectedCallback(): void {
        if (this.picker) return;
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = PICKER_CSS;
        const pick = <T extends string>(attr: string, all: readonly T[]): T | undefined => {
          const v = this.getAttribute(attr) as T | null;
          return v && all.includes(v) ? v : undefined;
        };
        const size = Number(this.getAttribute("size"));
        const model = pick<Model>("model", MODELS);
        const view = pick<View>("view", VIEWS);
        const format = pick<TextFormat>("format", TEXT_FORMATS);
        const fire = (type: "input" | "change", value: string): void => void this.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }));
        this.picker = createColourPicker({
          ...(this.getAttribute("value") ? { value: this.getAttribute("value")! } : {}),
          ...(model ? { model } : {}),
          ...(view ? { view } : {}),
          ...(format ? { format } : {}),
          ...(size > 0 ? { size } : {}),
          ...(this.getAttribute("contrast") ? { contrast: this.getAttribute("contrast")! } : {}),
          ...(this.getAttribute("theme") === "light" || this.getAttribute("theme") === "dark" ? { theme: this.getAttribute("theme") as "light" | "dark" } : {}),
          alpha: this.hasAttribute("alpha"),
          eyedropper: this.getAttribute("eyedropper") !== "false",
          injectStyles: false,
          onInput: (v) => fire("input", v),
          onChange: (v) => fire("change", v),
          onModel: (m) => this.setAttribute("model", m),
          onView: (v) => this.setAttribute("view", v),
        });
        root.replaceChildren(style, this.picker.el);
        // The inner controls' own input and change events are composed and would reach the page as native events with no `detail`; the page gets ours only.
        for (const type of ["input", "change"]) root.addEventListener(type, (e) => e.stopPropagation());
      }

      disconnectedCallback(): void {
        this.picker?.destroy();
        this.picker = null;
      }

      attributeChangedCallback(attr: string, _old: string | null, value: string | null): void {
        if (!this.picker) return;
        if (attr === "theme") {
          if (value === "light" || value === "dark") this.picker.el.dataset["cpTheme"] = value;
          else delete this.picker.el.dataset["cpTheme"];
          return;
        }
        if (value === null) return;
        if (attr === "value") this.picker.setValue(value);
        else if (attr === "model" && (MODELS as readonly string[]).includes(value)) this.picker.setModel(value as Model);
        else if (attr === "view" && (VIEWS as readonly string[]).includes(value)) this.picker.setView(value as View);
      }

      get value(): string {
        return this.picker?.value ?? this.getAttribute("value") ?? "";
      }

      set value(v: string) {
        this.setAttribute("value", v);
      }
    },
  );
}
