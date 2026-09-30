import type { MetadataRoute } from "next";

// Web app manifest (Next metadata route → /manifest.webmanifest). Makes RelayGoal
// installable to the home screen so it opens standalone, like a phone-native app —
// the point of the accessibility case: the relay lives one tap away, not behind a browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RelayGoal — the call, made for you",
    short_name: "RelayGoal",
    description:
      "Type a goal; RelayGoal makes the whole phone call and hands you back a verified answer bound to the exact words that were said.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#15110e",
    theme_color: "#15110e",
    categories: ["utilities", "productivity", "medical"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
