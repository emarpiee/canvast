import { beforeEach, describe, expect, it, vi } from "vitest";
import { isQuotaError, nearFullNotice, requestPersistence, resetQuotaNotices } from "../../src/storage/quota";

describe("storage quota", () => {
  beforeEach(resetQuotaNotices);

  it("recognises the quota error of each browser, and nothing else", () => {
    expect(isQuotaError(Object.assign(new Error("x"), { name: "QuotaExceededError" }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error("x"), { name: "NS_ERROR_DOM_QUOTA_REACHED" }))).toBe(true);
    expect(isQuotaError(new Error("Quota reached"))).toBe(true);
    expect(isQuotaError(new Error("network"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it("warns once at 80% and not below, and stays quiet when the browser reports nothing", async () => {
    const at = (usage: number) => ({ estimate: async () => ({ usage, quota: 100 }) });
    expect(await nearFullNotice(at(79))).toBeNull();
    expect(await nearFullNotice(at(85))).toMatch(/85% full/);
    expect(await nearFullNotice(at(95))).toBeNull(); // once per page load
    resetQuotaNotices();
    expect(await nearFullNotice({})).toBeNull();
    expect(await nearFullNotice({ estimate: async () => { throw new Error("no"); } })).toBeNull();
  });

  it("asks for persistence once, and not when it is already granted", async () => {
    const persist = vi.fn(async () => true);
    await requestPersistence({ persisted: async () => false, persist });
    await requestPersistence({ persisted: async () => false, persist });
    expect(persist).toHaveBeenCalledTimes(1);
    resetQuotaNotices();
    await requestPersistence({ persisted: async () => true, persist });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
