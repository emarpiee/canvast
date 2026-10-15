# ADR 0044 — Media keeps playing when deselected

- Status: accepted (Phase 6, owner request of 2026-10-15)
- Related: ADR 0041, 0042, engineering plan §14.36 (bounded decoders, no mass autoplay)

## Decision

- **One player per loaded instance** (own video element or GIF canvas), not one shared element. The selected instance also has the control bar; the others only show their picture.
- **Deselecting** an instance that is paused unloads it (its position stays saved); one that is **playing carries on**, bar-less, until it ends, is paused (select it again and press Pause), is deleted or hidden, or **leaves the view**, when it stops and writes its position (an unseen video must not keep a decoder busy).
- **Bounded:** at most 4 play at once; starting a fifth pauses the one that has played longest. Nothing ever starts by itself: only an explicit Play.
- **Writes** are unchanged: none while playing; pause, end, leaving the view, step, seek and repeat write one undo step.
- Volume is one device setting shared by all players; mute is per element.

## Not built

(Audio that is playing now continues out of view: ADR 0047.) A global "pause all" control, playing media continuing across a canvas switch (switching canvases stops it with its position saved).
