/**
 * What the paint chooser needs for texture fills (ADR 0154) from the app: choosing the source on the canvas, taking a picture file into the
 * library, the average colour of a source, and words for it. The controls themselves are `ui/texture-editor.ts`.
 */
import type { CanvasObject } from "../doc/model";
import type { TextureSource } from "../doc/texture";
import { averageColour } from "../render/texture";
import type { TextureHost } from "../render/texture";
import type { EditorState } from "./editor-state";
import { holdColourPopover } from "../ui/colour-popover";
import type { TextureHooks } from "../ui/texture-editor";

export function createTextureHooks(deps: {
  editor: EditorState;
  host: TextureHost;
  /** A picture file into the library: its hash, or null when it is not a picture. */
  importPicture(file: File): Promise<string | null>;
  nameOf(hash: string): string | undefined;
  /** A message for the person (empty: take the message away). */
  say(text: string): void;
}): TextureHooks {
  const { editor, host } = deps;
  let finish: ((src: TextureSource | null) => void) | null = null;
  const end = (src: TextureSource | null): void => {
    if (!finish) return;
    const done = finish;
    finish = null;
    editor.sourcePick = null;
    holdColourPopover(false);
    deps.say("");
    done(src);
  };
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && finish) {
        e.preventDefault();
        e.stopPropagation();
        end(null);
      }
    },
    true,
  );
  return {
    pickSource: (kind) =>
      new Promise((resolve) => {
        end(null); // (a pick that is still waiting is over)
        finish = resolve;
        holdColourPopover(true);
        editor.sourcePick = {
          kind,
          take: (objs: readonly CanvasObject[]) => {
            if (kind === "image") {
              const pic = objs.find((o) => o.kind === "image" && !o.media);
              if (!pic || pic.kind !== "image") return deps.say("That is not a picture. Click a picture, or press Esc.");
              return end({ kind: "asset", hash: pic.assetId });
            }
            if (!objs.length) return deps.say("Nothing there. Click what to repeat, or press Esc.");
            end({ kind: "objects", ids: objs.map((o) => o.id) });
          },
        };
        deps.say(kind === "image" ? "Click a picture on the canvas (Esc cancels)." : "Click what to repeat over the shape (Esc cancels).");
      }),
    async importFile(file) {
      const hash = await deps.importPicture(file);
      return hash ? { kind: "asset", hash } : null;
    },
    avg(src) {
      const source = src.kind === "asset" ? host.picture(src.hash, 64)?.source : host.objects(src.ids, 16)?.canvas;
      return source ? averageColour(source) : "#808080";
    },
    describe(src) {
      if (src.kind === "asset") return `Picture ${deps.nameOf(src.hash) ?? src.hash.slice(0, 8)}`;
      return `${src.ids.length} ${src.ids.length === 1 ? "object" : "objects"}`;
    },
  };
}
