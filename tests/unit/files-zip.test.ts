import { describe, expect, it } from "vitest";
import { kindFolder, safeName, uniquePath } from "../../src/storage/files-zip";

describe("plain ZIP of the original files", () => {
  it("groups by kind", () => {
    expect(kindFolder("image/png", "a.png")).toBe("Images");
    expect(kindFolder("video/mp4", "a.mp4")).toBe("Videos");
    expect(kindFolder("audio/mpeg", "a.mp3")).toBe("Audio");
    expect(kindFolder("application/pdf", "a.pdf")).toBe("PDFs");
    expect(kindFolder("application/octet-stream", "scan.PDF")).toBe("PDFs");
    expect(kindFolder("text/markdown", "n.md")).toBe("Text");
    expect(kindFolder("application/zip", "a.zip")).toBe("Other");
  });

  it("keeps the original wording and strips only what a file system refuses", () => {
    expect(safeName("Sunset over the sea (final).PNG", "x")).toBe("Sunset over the sea (final).PNG");
    expect(safeName("a/b\\c:d*e?f\"g<h>i|j.png", "x")).toBe("a-b-c-d-e-f-g-h-i-j.png");
    expect(safeName("日本語 ファイル.jpg", "x")).toBe("日本語 ファイル.jpg");
    expect(safeName("..  ", "fallback")).toBe("fallback");
    expect(safeName(".hidden", "x")).toBe("hidden");
  });

  it("numbers names that collide in one folder, without regard to case, and not across folders", () => {
    const taken = new Set<string>();
    expect(uniquePath(taken, "Images", "cat.png")).toBe("Images/cat.png");
    expect(uniquePath(taken, "Images", "CAT.png")).toBe("Images/CAT (2).png");
    expect(uniquePath(taken, "Images", "cat.png")).toBe("Images/cat (3).png");
    expect(uniquePath(taken, "Refs", "cat.png")).toBe("Refs/cat.png");
    expect(uniquePath(taken, "Text", "README")).toBe("Text/README");
    expect(uniquePath(taken, "Text", "README")).toBe("Text/README (2)");
  });
});
