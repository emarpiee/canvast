import { describe, expect, it } from "vitest";
import { kindFolder, safeName, uniquePath } from "../../src/storage/files-zip";

describe("plain ZIP of the original files", () => {
  it("groups by file extension, in lower case", () => {
    expect(kindFolder("image/png", "a.png")).toBe("png");
    expect(kindFolder("video/mp4", "Clip.MP4")).toBe("mp4");
    expect(kindFolder("model/gltf-binary", "item.obj")).toBe("obj");
    expect(kindFolder("application/octet-stream", "scan.PDF")).toBe("pdf");
    expect(kindFolder("application/zip", "a.tar.gz")).toBe("gz");
    expect(kindFolder("application/octet-stream", "README")).toBe("other");
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
    expect(uniquePath(taken, "png", "cat.png")).toBe("png/cat.png");
    expect(uniquePath(taken, "png", "CAT.png")).toBe("png/CAT (2).png");
    expect(uniquePath(taken, "png", "cat.png")).toBe("png/cat (3).png");
    expect(uniquePath(taken, "Refs", "cat.png")).toBe("Refs/cat.png");
    expect(uniquePath(taken, "Text", "README")).toBe("Text/README");
    expect(uniquePath(taken, "Text", "README")).toBe("Text/README (2)");
  });
});
