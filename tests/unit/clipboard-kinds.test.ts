import { describe, expect, it } from "vitest";
import { clipboardFor } from "../../src/assets/clipboard-kinds";

describe("what each kind of item is on the clipboard", () => {
  it("one answer per kind", () => {
    const cases: Array<[string, string, string]> = [
      ["a.md", "text/markdown", "note"], ["a.markdown", "text/markdown", "note"], ["a.txt", "text/plain", "text"], ["a.note.html", "text/html", "rich"],
      ["a.png", "image/png", "picture"], ["a.jpg", "image/jpeg", "picture"], ["a.webp", "image/webp", "picture"], ["a.tif", "image/tiff", "picture"],
      ["a.gif", "image/gif", "still"], ["a.svg", "image/svg+xml", "vector"],
      ["a.mp4", "video/mp4", "thumb"], ["a.mp3", "audio/mpeg", "thumb"],
      ["a.pdf", "application/pdf", "name"], ["a.zip", "application/zip", "name"], ["a.ttf", "font/ttf", "name"], ["a", "", "name"],
    ];
    for (const [name, type, want] of cases) expect(clipboardFor(name, type), name).toBe(want);
  });
});
