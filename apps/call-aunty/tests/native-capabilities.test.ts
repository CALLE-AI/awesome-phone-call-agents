import { describe, expect, it } from "vitest";
import { getCapabilitySummary, type NativeCapabilityState } from "../lib/native-capability-copy";

const ready: NativeCapabilityState = {
  biometricAvailable: true,
  secureStorageAvailable: true,
  backgroundTaskAvailable: true,
  backgroundTaskRegistered: true,
};

describe("native capability summaries", () => {
  it("describes a ready native configuration in English", () => {
    expect(getCapabilitySummary(ready, "en")).toEqual({
      backgroundLabel: "Background sync",
      background: "Ready when the device allows background work",
      storage: "Secure local storage is active",
      biometric: "Biometric unlock is ready",
    });
  });

  it("uses safe Bangla fallback copy when native capabilities are unavailable", () => {
    expect(getCapabilitySummary({ ...ready, backgroundTaskAvailable: false, backgroundTaskRegistered: false, biometricAvailable: false }, "bn")).toEqual({
      backgroundLabel: "ব্যাকগ্রাউন্ড সিঙ্ক",
      background: "অ্যাপ খোলা থাকলে ব্যবহার করা যাবে",
      storage: "সুরক্ষিত লোকাল স্টোরেজ চালু আছে",
      biometric: "বায়োমেট্রিক পাওয়া যায়নি",
    });
  });

  it("localizes capability labels for Hindi and Urdu", () => {
    expect(getCapabilitySummary(ready, "hi").backgroundLabel).toBe("बैकग्राउंड सिंक");
    expect(getCapabilitySummary({ ...ready, secureStorageAvailable: false }, "ur").storage).toContain("محفوظ اسٹوریج");
  });
});
