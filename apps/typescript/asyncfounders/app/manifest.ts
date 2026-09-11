import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AsyncFounders",
    short_name: "AsyncFounders",
    description: "Persistent, source-backed company memory for distributed founders and teams.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7faf7",
    theme_color: "#050805",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
