# ADR 0189: Blur types, pixelate, wider adjustment ranges

- Status: **accepted** (2026-11-12)
- Related: ADR 0118 and 0123 (the Adjust panel), ADR 0136 (levels, curves, primaries), ADR 0188 (adjustment shapes)

## Decision

- **Ranges**: each adjustment has its own range (`AdjustSpec.max`, `ADJUSTMENTS` in `doc/adjust.ts`), past 100 where a stronger change still means something: exposure, temperature, tint, red, green and blue -200 to 200; contrast, saturation and vibrance -100 to 200 (below -100 is nothing more); blur 0 to 400; sharpen and grain 0 to 200; shadow blur and spread 0 to 400, offset ±300. Every formula was already linear in the number, so a bigger number is only a stronger change. `validAdjust` and `cleanAdjust` hold each to its range.
- **Blur types** (`Adjust.blurType`, absent = soft): *motion* along `blurAngle` (degrees), *zoom* out from the middle, *spin* round it, as wide as a soft blur of the same number (about six standard deviations end to end). Made from copies of the layer laid over each other on the graphics card, each the average of those before, then softened by the step between copies (`render/blur-types.ts` `typedBlur`), for shapes (`drawAdjusted`) and pictures (`adjustInto`). The type is kept only with a blur, the angle only with a motion blur.
- **Pixelate** (`Adjust.pixelate`, 0 to 100): square cells, at 100 a tenth of the object; the layer drawn small, then large with no smoothing (`pixelateInto`). Like a blur it needs the pixels round it, so it is drawn at the size seen.
- The panel's Detail group: Blur, its *Type*, the *Angle* (motion only), Sharpen, Grain, Pixelate; the group's Reset takes the type too.

## Consequences

- SVG has only a Gaussian blur: the other types are written as a soft blur of the same width, and pixelate is left out.
- A playing video or GIF is adjusted by the browser's filter (soft blur only, no pixelate); its paused frame is drawn with them.
- Older versions read a number past 100 as out of range and drop that adjustment; they ignore the blur type (soft) and pixelate.
