import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clock, colors, pretty, reelFont } from "./font";
import type { CallReelProps } from "./types";

const LABELS: Record<string, string> = {
  safety_status: "Safety",
  evacuation: "Evacuation",
  has_power: "Power",
  has_water: "Water",
  medication: "Medication",
  household: "Household",
  needs_human: "Needs human",
  employment_confirmed: "Employment",
  title_stated: "Title",
  start_date_stated: "Start date",
  end_date_stated: "End date",
  eligible_for_rehire: "Eligible for rehire",
  verifier_name: "Verifier",
  verifier_role: "Role",
  verifier_authority: "Authority",
  refusal_reason: "Refusal",
};

export const CALL_REEL_FPS = 30;
export const CALL_REEL_WIDTH = 960;
export const CALL_REEL_HEIGHT = 540;
export const CALL_REEL_DURATION_FALLBACK = 360;

export function callReelFrames(turnCount: number): number {
  return Math.max(360, 80 + turnCount * 32 + 70);
}

export function CallReel({ household, disposition, transcript_turns, linked, peerLabel = "Household" }: CallReelProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const lastOffset = transcript_turns.at(-1)?.offset_seconds ?? 50;
  const playhead = interpolate(frame, [0, durationInFrames], [0, lastOffset], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const missed = disposition.includes("voicemail") || disposition === "no_answer" || disposition === "invalid_number";
  const overflow = Math.max(0, transcript_turns.length * 58 - 360);
  const scroll = interpolate(frame, [40, durationInFrames - 20], [0, overflow], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas, fontFamily: reelFont, color: colors.ink }}>
      <div style={{ padding: 28, height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 13, color: colors.mute }}>Call</div>
            <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{household}</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: missed ? colors.unaccounted : colors.safe }}>
            {pretty(disposition)}
          </div>
        </div>

        <div style={{ background: colors.card, borderRadius: 16, padding: "12px 16px" }}>
          <div style={{ position: "relative", height: 10 }}>
            <div style={{ position: "absolute", inset: 0, background: colors.canvas, borderRadius: 999 }} />
            <div
              style={{
                position: "absolute",
                top: -3,
                left: `${(playhead / Math.max(lastOffset, 1)) * 100}%`,
                width: 16,
                height: 16,
                marginLeft: -8,
                borderRadius: 999,
                background: colors.ink,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: colors.mute, fontVariantNumeric: "tabular-nums" }}>
            <span>0:00</span>
            <span>{clock(playhead)}</span>
            <span>{clock(lastOffset)}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, minHeight: 0, flex: 1 }}>
          <div style={{ background: colors.card, borderRadius: 16, padding: 16, overflow: "hidden" }}>
            <div style={{ transform: `translateY(-${scroll}px)` }}>
              {transcript_turns.map((turn, index) => {
                const start = 12 + index * 28;
                const opacity = interpolate(frame, [start, start + 10], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                const field = linked.find((item) => item.turnText === turn.text);
                const accent = field ? (field.supported ? colors.safe : colors.critical) : "transparent";
                return (
                  <div
                    key={`${turn.offset_seconds}-${index}`}
                    style={{
                      opacity,
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: turn.speaker === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "88%",
                        background: colors.canvas,
                        borderRadius: 14,
                        padding: "8px 12px",
                        borderLeft: turn.speaker === "user" ? `3px solid ${accent}` : "3px solid transparent",
                      }}
                    >
                      <div style={{ fontSize: 11, color: colors.mute, fontVariantNumeric: "tabular-nums" }}>
                        {turn.speaker === "user" ? peerLabel : "Assistant"} · {clock(turn.offset_seconds)}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45 }}>{turn.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            {linked.map((field, index) => {
              const start = 36 + index * Math.round(fps * 0.45);
              const opacity = interpolate(frame, [start, start + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const x = interpolate(frame, [start, start + 8], [18, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={field.field}
                  style={{
                    opacity,
                    transform: `translateX(${x}px)`,
                    background: colors.card,
                    borderRadius: 16,
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 11, color: colors.mute }}>{LABELS[field.field] ?? pretty(field.field)}</div>
                    {field.turnOffset != null ? (
                      <div style={{ fontSize: 11, color: colors.mute, fontVariantNumeric: "tabular-nums" }}>
                        {clock(field.turnOffset)}
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 18,
                      fontWeight: 600,
                      color: field.supported ? colors.ink : colors.critical,
                      textDecoration: field.supported ? "none" : "line-through",
                    }}
                  >
                    {pretty(field.value)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: field.supported ? colors.mute : colors.critical }}>
                    {field.supported && field.turnText
                      ? `“${field.turnText}”`
                      : "Not on the transcript"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
