import { describe, expect, it } from "vitest";
import { getAppCopy, getCareCopy } from "../lib/app-copy";

describe("app copy resources", () => {
  it("provides complete Home flow copy in both languages", () => {
    const english = getAppCopy("en");
    const bangla = getAppCopy("bn");
    expect(english.startCheckIn).toBe("Start today’s check-in");
    expect(bangla.startCheckIn).toBe("আজকের চেক-ইন শুরু করুন");
    expect(english.callHandoffBody).not.toBe(bangla.callHandoffBody);
    expect(english.emergencyBody).not.toBe(bangla.emergencyBody);
    expect(english.reconciliationLatestCardTitle).toBe("Latest decision");
    expect(bangla.reconciliationLatestCardTitle).toBe("সর্বশেষ সিদ্ধান্ত");
    expect(english.reconciliationLatestCardOpen).not.toBe(bangla.reconciliationLatestCardOpen);
    expect(english.chwOpenCount(3)).toBe("3 open");
    expect(bangla.chwOpenCount(3)).toBe("3টি খোলা");
    expect(english.chwRetryQueued).not.toBe(bangla.chwRetryQueued);
    expect(english.chwNewFollowUp).not.toBe(bangla.chwNewFollowUp);
    expect(english.chwQueue).toHaveLength(12);
    expect(bangla.chwQueue).toHaveLength(12);
    expect(english.chwQueue[0].name).toBe("Rina Begum");
    expect(bangla.chwQueue[0].name).toBe("রিনা বেগম");
    expect(english.chwQueue[3].name).toBe("Farhana Islam");
    expect(bangla.chwQueue[3].name).toBe("ফারহানা ইসলাম");
    expect(english.searchPlaceholder).not.toBe(bangla.searchPlaceholder);
    expect(english.fieldActivity).not.toBe(bangla.fieldActivity);
    expect(english.chwQueue[0].meta).not.toBe(bangla.chwQueue[0].meta);
    expect(english.chwQueue[0].urgency).toBe("Urgent");
    expect(bangla.chwQueue[0].urgency).toBe("জরুরি");
    expect(english.todayFocus).toBe("Start here");
    expect(bangla.todayFocus).toBe("এখান থেকে শুরু করুন");
    expect(english.filterEmpty).not.toBe(bangla.filterEmpty);
    expect(english.headerCall).not.toBe(bangla.headerCall);
    expect(english.unexpectedErrorTitle).not.toBe(bangla.unexpectedErrorTitle);
    expect(english.syncFallbackNotice).not.toBe(bangla.syncFallbackNotice);
    expect(english.privacyActionError).not.toBe(bangla.privacyActionError);
  });

  it("provides complete Care Plan headings and referral actions", () => {
    const english = getCareCopy("en");
    const bangla = getCareCopy("bn");
    expect(english.journey).toBe("PREGNANCY JOURNEY");
    expect(bangla.journey).toBe("গর্ভাবস্থার যাত্রা");
    expect(english.call).toBe("Call");
    expect(bangla.call).toBe("কল");
  });
});
