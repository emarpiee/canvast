import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_GAP_MS, QUIET_MS, installAutoIndex } from "../../src/storage/auto-index";
import { externalFolder } from "../../src/storage/external-folder";
import type { Dir } from "../../src/storage/external-folder";
import type { ExportResult } from "../../src/storage/archive";

function dir(): Dir & { files: Map<string, Blob> } {
  const d = {
    name: "lib",
    files: new Map<string, Blob>(),
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!d.files.has(name)) {
        if (!o?.create) throw new DOMException("none", "NotFoundError");
        d.files.set(name, new Blob([]));
      }
      return { getFile: async () => new File([d.files.get(name)!], name), createWritable: async () => ({ write: async (b: Blob) => void d.files.set(name, b), close: async () => undefined }) };
    },
    async removeEntry(name: string) {
      d.files.delete(name);
    },
  };
  return d;
}

const result = (n: number): ExportResult => ({ blob: new Blob(["x".repeat(n)]) }) as unknown as ExportResult;

describe("the library index follows the workspace by itself", () => {
  let d: ReturnType<typeof dir>;
  beforeEach(async () => {
    vi.useFakeTimers();
    d = dir();
    await externalFolder.use(d);
  });
  afterEach(() => vi.useRealTimers());

  const make = (over: Partial<Parameters<typeof installAutoIndex>[0]> = {}) => {
    const build = vi.fn(async () => result(5));
    const say = vi.fn();
    const ai = installAutoIndex({ enabled: () => true, readOnly: () => false, build, say, now: () => Date.now(), ...over });
    return { build, say, ai };
  };

  it("writes once, a little after the last of several changes, and not again until something changes", async () => {
    const { build, ai } = make();
    ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1000);
    ai.poke(); // a later change moves the write back
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1000);
    expect(build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(build).toHaveBeenCalledTimes(1);
    expect(d.files.get(".canvast-index")!.size).toBe(5);
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("waits a minute between two writes however often it is poked", async () => {
    const { build, ai } = make();
    ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS + 10);
    expect(build).toHaveBeenCalledTimes(1);
    ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS + 10);
    expect(build).toHaveBeenCalledTimes(1); // too soon after the last one
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when the setting is off, when this tab is read-only, or when no folder is in use", async () => {
    const off = make({ enabled: () => false });
    off.ai.poke();
    const ro = make({ readOnly: () => true });
    ro.ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(off.build).not.toHaveBeenCalled();
    expect(ro.build).not.toHaveBeenCalled();
    await externalFolder.use(null);
    const none = make();
    none.ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(none.build).not.toHaveBeenCalled();
  });

  it("says once when a write fails, tries again after the next change, and says when it is saved again", async () => {
    let fail = true;
    const { build, say, ai } = make({});
    build.mockImplementation(async () => {
      if (fail) throw new Error("the disk is full");
      return result(3);
    });
    ai.poke();
    await vi.advanceTimersByTimeAsync(QUIET_MS + 10);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0]![0]).toContain("the disk is full");
    ai.poke();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS + QUIET_MS);
    expect(say).toHaveBeenCalledTimes(1); // still failing: not said again
    fail = false;
    ai.poke();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS + QUIET_MS);
    expect(say).toHaveBeenLastCalledWith("The library index is saved again.");
  });
});
