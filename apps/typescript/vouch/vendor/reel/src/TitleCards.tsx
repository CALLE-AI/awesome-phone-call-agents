import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { colors, reelFont } from "./font";
import type { TitleCardsProps } from "./types";

export const TITLE_CARDS_FPS = 30;
export const TITLE_CARDS_DURATION = 360;
export const TITLE_CARDS_WIDTH = 960;
export const TITLE_CARDS_HEIGHT = 540;

function Card({ kicker, title, note }: { kicker: string; title: string; note: string }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, 108, 120], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [0, 12], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas, fontFamily: reelFont, color: colors.ink }}>
      <div
        style={{
          opacity,
          transform: `translateY(${y}px)`,
          height: "100%",
          padding: 64,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 16, color: colors.mute }}>{kicker}</div>
        <div style={{ marginTop: 18, fontSize: 48, fontWeight: 600, lineHeight: 1.15, maxWidth: 720 }}>{title}</div>
        <div style={{ marginTop: 22, fontSize: 18, color: colors.mute }}>{note}</div>
      </div>
    </AbsoluteFill>
  );
}

export function TitleCards({ event = "Bennett Valley fire" }: TitleCardsProps) {
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={120}>
        <Card kicker={event} title="The people you cannot reach are the job." note="CASPER by phone. One hour, not three days." />
      </Sequence>
      <Sequence from={120} durationInFrames={120}>
        <Card kicker="headcount" title="Dialed. Reached. Unreached." note="Voicemail is not a reach." />
      </Sequence>
      <Sequence from={240} durationInFrames={120}>
        <Card kicker="This video" title="Rendered by the product." note="A real call’s JSON in, MP4 out." />
      </Sequence>
    </AbsoluteFill>
  );
}
