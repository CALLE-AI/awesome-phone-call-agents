"use client";

import { useEffect } from "react";

// Registers the service worker so RelayGoal is installable and works offline as a shell.
// No UI; failures are swallowed so a browser without SW support degrades to a normal page.
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
