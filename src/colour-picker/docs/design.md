# Design

## Why these models

HSL and HSV are the ones people know, but their lightness and saturation are not even: a yellow and a blue of the same HSL lightness differ greatly in how light they look, so a slider moves through colours unevenly. OKLab fixes this, and Ottosson's OKHSL and OKHSV bring OKLab back to the familiar controls, scaled to the sRGB gamut so **every position of every slider is a colour a screen can show** (no clipped, dead corners).

| Model | Channels | When it fits |
| --- | --- | --- |
| OKHSL | hue, saturation, lightness | "Make it lighter or paler"; greys and tints. Lightness 0 and 1 are black and white at any saturation. |
| OKHSV | hue, saturation, value | The Photoshop-style box: the corner is the pure colour. The default. |
| OKHCL | hue, chroma, lightness | Lightness is OKLab's own, so equal L means equal brightness across hues; chroma is the fraction of the gamut at that lightness and hue, so it never clips. For building palettes of even weight. |

Switching model converts the colour, so it never changes: only the controls do. A grey keeps the hue you had.

## Why four layouts

One layout cannot be best at everything, so the picker offers four and remembers the choice (your host does, through `onView`).

* **Ring and box** is the fast way to a colour: a gesture for the hue, a gesture for the rest.
* **Plane and bar** gives the two channels more room, which matters on a small screen and for a coarse pointer.
* **Sliders** are the most precise and the most accessible: every channel has a number and a native range.
* **Ring and sliders** is for working a colour: rough with the ring, fine with the sliders, no switching.

## Choices worth knowing

* **Opaque values keep the opacity.** With `alpha` on, choosing a swatch or typing `#rrggbb` keeps the current opacity: a swatch is a colour, not a fill with its own opacity. Typing `#rrggbbaa`, `rgb(… / a)` or `oklch(… / a)` sets it.
* **Text is parsed as you type**, so a colour pasted in any format works at once; Enter and leaving the field normalize it.
* **The "before" half of the preview is a button.** One click returns to where you started, which is the undo people reach for in a picker.
* **No state of its own.** The picker keeps nothing between uses; the host stores the model, layout, format and recent colours. That is what lets it live in a popover, a panel, a settings row or a web page unchanged.
* **Words and looks are options.** No string or colour is fixed.

## What comes next, in the order I would build it

| # | Feature | Why |
| --- | --- | --- |
| 1 | **Gradient editor** (stops on a bar, add, drag and delete a stop, angle and type, each stop opening this picker) | Every vector editor needs it; canvast's vector fills are the first user. Reuses the picker for each stop. |
| 2 | **Display P3 and wide gamut** (`color(display-p3 …)` output, a gamut toggle) | Screens are wider than sRGB; the models extend to a bigger gamut by changing the gamut function. |
| 3 | **Colour-blindness preview** (protan, deutan, tritan swatches of the current colour) | Cheap with the matrices, and the contrast readout already points that way. |
| 4 | **Pick from an image with a loupe** | The eyedropper fallback for Firefox and Safari, which have no `EyeDropper`. |
| 5 | **Named palettes** (import and export `.gpl` and `.ase`; the host stores them) | A palette is the thing people bring to a picker. |
| 6 | **npm package** (ESM with types, `exports` map, the licence notice in the tarball) and **React and Vue wrappers** | The custom element works today; wrappers make the events idiomatic. |
| 7 | **APCA contrast** beside WCAG 2 | The newer method; both are asked for. |
