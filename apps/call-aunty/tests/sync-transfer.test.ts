import { describe, expect, it } from "vitest";
import { advanceTransferProgress, createTransferProgress, isTransferComplete } from "../lib/sync-transfer";
import { getSyncTransferCopy } from "../lib/sync-transfer-copy";

describe("sync transfer progress", () => {
  it("creates metadata-only progress and advances without exceeding the batch", () => {
    const initial = createTransferProgress(3, "transfer:test");
    expect(initial).toMatchObject({ transferId: "transfer:test", totalItems: 3, completedItems: 0 });
    const advanced = advanceTransferProgress(initial, 2);
    expect(advanced.completedItems).toBe(2);
    expect(advanceTransferProgress(advanced, 9).completedItems).toBe(3);
    expect(isTransferComplete(advanced)).toBe(false);
    expect(isTransferComplete(advanceTransferProgress(advanced, 3))).toBe(true);
  });

  it("treats an empty batch as complete", () => {
    expect(isTransferComplete(createTransferProgress(0))).toBe(true);
  });

  it("provides consent copy for every supported language", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const copy = getSyncTransferCopy(language);
      expect(copy.confirmTitle.length).toBeGreaterThan(0);
      expect(copy.wifiBody.length).toBeGreaterThan(0);
      expect(copy.resume(1, 2).length).toBeGreaterThan(0);
    }
  });
});
