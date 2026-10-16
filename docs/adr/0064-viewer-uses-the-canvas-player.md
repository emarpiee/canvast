# ADR 0064: the Assets viewer uses the on-canvas player

Status: accepted (owner request, 2026-10-16)

The viewer used the browser's own `<video controls>` for video and audio and a plain animated `<img>` for GIFs, which looked different from the canvas player and ignored its settings. Now video, audio and animated GIFs open with the **same engines** as the on-canvas player (`avEngine` for an HTML media element, `gifEngine` for the frame-by-frame GIF decoder, both exported from `ui/media-player.ts`) and a control bar (`ui/player-controls.ts`) with the same look and device settings: position slider and time, step back and forward (video 3 s, audio 1 s, GIF 1 frame by default), play and pause, repeat, mute and volume. The viewer only plays (it never writes to a document, so there is no extract-frame or save-position there).

- A file the browser cannot decode (say H.265) still falls back to its thumbnail with the note; a GIF that cannot be decoded shows as a plain picture.
- The slideshow plays a video or audio file to its end (the engine's `onEnded` steps on); a GIF loops until the slide timer moves on.
- The bar sits over the bottom of the picture (two rows on a phone), stops its own pointer events so it never pans or clicks the picture, and its keys (the sliders) do not reach the viewer's shortcuts.
- Zoom, pan and the Fit/100% toggle work on the GIF canvas like on the picture.
