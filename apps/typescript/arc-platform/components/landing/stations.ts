import type { TunerSegment } from "@/components/ui/tuner-strip"

/**
 * Landing hero dial - BRANDING.md v1.1 section 5: "Segments are stations.
 * Labels are real frequencies."
 *
 * These are real Pakistani FM stations. Weights are the relative share of a
 * sample national buy, which is why the widths vary - the dial is reading
 * something, not decorating.
 *
 * `tone` is a token name, never a hex. See BRANDING.md section 9.
 */
export const HERO_STATIONS: TunerSegment[] = [
  { id: "city89",  label: "89.0",  caption: "City FM89",   weight: 14, tone: "lilac"  },
  { id: "radio1",  label: "91.0",  caption: "Radio1",      weight: 9,  tone: "blush"  },
  { id: "power99", label: "99.0",  caption: "Power99",     weight: 11, tone: "butter" },
  { id: "fm100",   label: "100.0", caption: "FM100",       weight: 18, tone: "lilac"  },
  { id: "fm101",   label: "101.0", caption: "Radio Pak",   weight: 8,  tone: "blush"  },
  { id: "mast103", label: "103.0", caption: "Mast FM103",  weight: 13, tone: "butter" },
  { id: "hot105",  label: "105.0", caption: "Hot FM105",   weight: 16, tone: "lilac"  },
  { id: "apna107", label: "107.0", caption: "Apna Karachi", weight: 11, tone: "blush" },
]
