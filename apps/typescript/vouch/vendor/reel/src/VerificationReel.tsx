import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, reelFont } from "./font";
import type { VerificationReelProps } from "./types";

export const VERIFICATION_REEL_FPS = 30;
export const VERIFICATION_REEL_DURATION = 240;
export const VERIFICATION_REEL_WIDTH = 960;
export const VERIFICATION_REEL_HEIGHT = 540;

function countUp(frame: number, start: number, target: number) {
  const progress = interpolate(frame, [start, start + 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return Math.round(target * progress);
}

export function VerificationReel({ dialed, confirmed, blocked, names = [] }: VerificationReelProps) {
  const frame = useCurrentFrame();
  const shownDialed = countUp(frame, 6, dialed);
  const shownConfirmed = countUp(frame, 22, confirmed);
  const shownBlocked = countUp(frame, 38, blocked);
  const listOpacity = interpolate(frame, [78, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const listY = interpolate(frame, [78, 96], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas, fontFamily: reelFont, color: colors.ink }}>
      <div style={{ padding: 32, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, color: colors.mute }}>Salary history never reaches the task</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <Stat label="Dialed" value={shownDialed} color={colors.ink} />
          <Stat label="Confirmed" value={shownConfirmed} color={colors.safe} />
          <Stat label="Blocked" value={shownBlocked} color={colors.critical} />
        </div>
        <div
          style={{
            opacity: listOpacity,
            transform: `translateY(${listY}px)`,
            background: colors.card,
            borderRadius: 16,
            padding: 22,
            minHeight: 148,
          }}
        >
          <div style={{ fontSize: 13, color: colors.mute, marginBottom: 12 }}>No consent, or third-party only</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {names.map((name, index) => {
              const start = 90 + index * 8;
              const opacity = interpolate(frame, [start, start + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <span
                  key={name}
                  style={{
                    opacity,
                    background: colors.canvas,
                    borderRadius: 999,
                    padding: "7px 12px",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {name}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: colors.card, borderRadius: 16, padding: 22 }}>
      <div style={{ fontSize: 13, color: colors.mute }}>{label}</div>
      <div
        style={{
          marginTop: 10,
          fontSize: 56,
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}