import { useMemo } from "react";

import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";

/** Soft surface tints derived from the active palette (light/dark aware). */
export function useUiTints() {
  const colors = useColors();
  const scheme = useColorScheme();
  const dark = scheme === "dark";

  return useMemo(
    () => ({
      coral: colors.coral,
      coralSoft: dark ? "#3A2A28" : "#FFF0ED",
      coralMid: dark ? "#4A3532" : "#FFD9D2",
      coralBorder: dark ? "#6B4540" : "#F6C5BA",
      lavenderSoft: dark ? "#2A2C45" : "#EEF0FF",
      lavenderBorder: dark ? "#4A4D7A" : "#C7CBFF",
      amberSoft: dark ? "#3A3220" : "#FFF7E6",
      mintSoft: colors.mint,
      primarySoft: dark ? "#2E3050" : "#EEF0FF",
      securitySoft: dark ? "#2E3050" : "#EEF0FF",
      securityBorder: dark ? "#4A4D7A" : "#C7CBFF",
      heroBody: dark ? "#C8CAF5" : "#E7E6FF",
      heroOverline: dark ? "#B8BAE8" : "#DCD9FF",
      actionSub: dark ? "#F5D4CB" : "#FBE7E1",
      scrim: "rgba(25, 22, 38, 0.48)",
    }),
    [colors.coral, colors.mint, dark],
  );
}
