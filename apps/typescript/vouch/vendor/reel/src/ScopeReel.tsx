import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clock, colors, pretty, reelFont } from "./font";
import type { ScopeReelProps } from "./types";

export const SCOPE_REEL_FPS = 30;
export const SCOPE_REEL_DURATION = 240;
export const SCOPE_REEL_WIDTH = 960;
export const SCOPE_REEL_HEIGHT = 540;

const LABELS: Record<string, string> = {
  employment_confirmed: "Employment",
  title_stated: "Title",
  start_date_stated: "Start date",
  end_date_stated: "End date",
  eligible_for_rehire: "Eligible for rehire",
  salary_history: "Salary history",
};

export function scopeReelFrames(turnCount: number): number {
  return Math.max(240, 90 + turnCount * 36 + 40);
}

export function ScopeReel({
  candidate = "Candidate",
  jurisdiction = "US-CA",
  requested,
  permitted,
  blocked,
  transcript_turns = [],
  peerLabel = "Verifier",
}: ScopeReelProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const blockedByField = new Map(blocked.map((item) => [item.field, item.reason]));
  const titleIn = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const overflow = Math.max(0, transcript_turns.length * 58 - 280);
  const scroll = interpolate(frame, [50, durationInFrames - 16], [0, overflow], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas, fontFamily: reelFont, color: colors.ink }}>
      <div style={{ padding: 24, height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ opacity: titleIn, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 13, color: colors.mute }}>No consent artifact, no dial</div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{candidate}</div>
          </div>
          <div style={{ fontSize: 13, color: colors.mute }}>{jurisdiction}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ChipList
            title="Requested"
            frame={frame}
            start={12}
            items={requested.map((field) => ({
              field,
              struck: blockedByField.has(field),
              hint: blockedByField.get(field),
            }))}
          />
          <ChipList
            title="Permitted"
            frame={frame}
            start={16}
            items={permitted.map((field) => ({ field }))}
          />
        </div>

        <div
          style={{
            background: colors.card,
            borderRadius: 16,
            padding: 14,
            overflow: "hidden",
            flex: 1,
            minHeight: 0,
            opacity: interpolate(frame, [18, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Transcript</div>
          {transcript_turns.length === 0 ? (
            <div style={{ fontSize: 13, color: colors.mute }}>No call yet. Confirm dial to land a transcript.</div>
          ) : (
            <div style={{ transform: `translateY(-${scroll}px)` }}>
              {transcript_turns.map((turn, index) => {
                const start = 26 + index * 18;
                const opacity = interpolate(frame, [start, start + 10], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                return (
                  <div
                    key={`${turn.offset_seconds}-${index}`}
                    style={{
                      opacity,
                      marginBottom: 8,
                      display: "flex",
                      justifyContent: turn.speaker === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "82%",
                        background: colors.canvas,
                        borderRadius: 12,
                        padding: "7px 11px",
                      }}
                    >
                      <div style={{ fontSize: 11, color: colors.mute, fontVariantNumeric: "tabular-nums" }}>
                        {turn.speaker === "user" ? peerLabel : "Assistant"} · {clock(turn.offset_seconds)}
                      </div>
                      <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.35 }}>{turn.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ChipList({
  title,
  items,
  frame,
  start,
}: {
  title: string;
  items: Array<{ field: string; struck?: boolean; hint?: string }>;
  frame: number;
  start: number;
}) {
  const opacity = interpolate(frame, [start, start + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        opacity,
        background: colors.card,
        borderRadius: 14,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((item, index) => {
          const chipIn = interpolate(frame, [start + 8 + index * 4, start + 16 + index * 4], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={item.field}
              style={{
                opacity: chipIn,
                background: item.struck ? "rgba(222, 17, 53, 0.08)" : colors.canvas,
                color: item.struck ? colors.critical : colors.ink,
                textDecoration: item.struck ? "line-through" : "none",
                borderRadius: 999,
                padding: "4px 9px",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {LABELS[item.field] ?? pretty(item.field)}
              {item.hint ? ` · ${item.hint}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}