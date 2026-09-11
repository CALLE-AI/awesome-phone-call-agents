"use client";

import { useEffect } from "react";

/**
 * Review-only: opens the first inline call card after mount, and stubs the
 * dial-target lookup so the indicator renders without a signed-in session.
 * The component under it is the real one - nothing is mocked up.
 */
export default function AutoOpen() {
  useEffect(() => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/calle/dial-target")) {
        return {
          ok: true,
          json: async () => ({
            resolved: "+923005550000", source: "demo-env",
            valid: true, live: true, fallbackActive: true,
          }),
        } as Response;
      }
      return realFetch(url as RequestInfo, init);
    }) as typeof fetch;

    const t = setTimeout(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => (b.textContent ?? "").trim() === "Call");
      btn?.click();
    }, 60);
    return () => clearTimeout(t);
  }, []);
  return null;
}
