import { describe, expect, it } from "vitest";
import { COPY_MARK, clipboardEntries } from "../../desktop/clipboard-entries";

describe("what a copy offers on each system", () => {
  const URLS = ["file:///a/one.png", "file:///a/two%20b.mp4"];
  const RAW = (f: string) => `electron application/osclipboard;format="${f}"`;

  it("files by Electron's own name on every system, as Electron maps it to the system's own; GNOME's list only on Linux", () => {
    for (const platform of ["linux", "win32", "darwin"] as const) expect(clipboardEntries(URLS, {}, platform)["text/uri-list"], platform).toBe("file:///a/one.png\r\nfile:///a/two%20b.mp4");
    expect(Object.keys(clipboardEntries(URLS, {}, "linux"))).toContain(RAW("x-special/gnome-copied-files"));
    for (const platform of ["win32", "darwin"] as const) expect(Object.keys(clipboardEntries(URLS, {}, platform)), platform).toEqual(["text/uri-list"]);
  });

  it("a picture and words by plain names, an SVG by the system's own, and nothing about files when there are none", () => {
    const also = { svg: "<svg/>", png: new Uint8Array([1, 2]), text: "words" };
    for (const [platform, svg] of [["linux", "image/svg+xml"], ["win32", "image/svg+xml"], ["darwin", "public.svg-image"]] as const) {
      const out = clipboardEntries([], also, platform);
      expect(Object.keys(out).sort(), platform).toEqual([RAW(svg), "image/png", "text/plain"].sort());
      expect((out["image/png"] as Blob).type).toBe("image/png");
    }
  });

  it("takes only what it knows the shape of: this comes over from the page", () => {
    expect(clipboardEntries([], { svg: 1, png: "not bytes", text: {}, mark: 1 }, "linux")).toEqual({});
    expect(clipboardEntries([], { mark: "abc" }, "win32")).toEqual({ [COPY_MARK]: "abc" });
  });
});
