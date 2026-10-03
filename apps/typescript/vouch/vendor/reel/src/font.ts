import { loadFont } from "@remotion/google-fonts/PlusJakartaSans";

const loaded = loadFont("normal", {
  subsets: ["latin"],
  weights: ["400", "500", "600"],
});

export const reelFont = loaded.fontFamily;

export const colors = {
  canvas: "#f3f3f3",
  card: "#ffffff",
  ink: "#0d0d0d",
  mute: "#5e5e5e",
  line: "#ebebeb",
  safe: "#06c167",
  critical: "#de1135",
  unaccounted: "#c4841d",
} as const;

export function clock(seconds?: number) {
  const value = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, "0")}`;
}

export function pretty(value: unknown) {
  return String(value).replaceAll("_", " ");
}
