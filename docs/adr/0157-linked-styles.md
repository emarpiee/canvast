# ADR 0157: objects follow the saved colour or gradient they were painted with

Status: accepted (owner request, 2026-10-19)

Applying a saved colour or gradient from the Styles panel (Apply to the fill, Apply to the outline, or pressing its card) now links the painted part to the style. The paint is still stored on the object as before (a canvas drawn without the style looks the same), and the object keeps `styles: { fill?: id, stroke?: id }`.

- **Editing the style updates the objects.** Changing a saved colour (Change colour) or a saved gradient (Edit the gradient) puts the new paint on every object of the open canvas that follows it, as one undo step ("Update from the saved style").
- **Opening a canvas.** Objects of a canvas opened later are brought in step with the styles right after it loads, with no undo step (`DocumentStore.refit`, only while the history is empty).
- **Changing the part by hand unlinks it.** Every paint edit goes through `paintedWith` (`app/actions.ts`): a change of the fill or outline without a style removes the link of that part; the other part keeps its own.
- **Deleting the style** leaves the objects as they are and unlinks them.
- **Adjustments follow too.** A picture that got a saved adjustment follows it; the card's menu has "Update from the picked picture", which replaces the saved adjustment with the picked picture's and so changes every picture that follows it. Changing a picture's adjustments any other way (the Adjust panel, Reset, a gradient map, paste) unlinks it.
- **What is not linked, on purpose:** the colours of a palette (a palette is a list: taking a colour out or sorting it would silently recolour the objects that follow the colour at that place), text styles (a text look is changed in many places, so there is no single moment to unlink it), and the colours picked from the picker's Saved colours (they are plain colours).

The links are one optional field of every object (`ObjectBase.styles`, `doc/style-links.ts`), written and read with the object, so copies, duplicates, archives and undo carry them.
