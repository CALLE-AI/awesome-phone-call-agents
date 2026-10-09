"use client";

import {
  CallReel,
  CALL_REEL_FPS,
  CALL_REEL_HEIGHT,
  CALL_REEL_WIDTH,
  CoverageReel,
  COVERAGE_REEL_DURATION,
  COVERAGE_REEL_FPS,
  COVERAGE_REEL_HEIGHT,
  COVERAGE_REEL_WIDTH,
  callReelFrames,
  type CallReelProps,
  type CoverageReelProps,
} from "@caller-ai/reel";
import { Player } from "@remotion/player";

export function CallReelPlayer({ compact, ...props }: CallReelProps & { compact?: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white shadow-card ${compact ? "mx-auto max-w-[720px]" : ""}`}
    >
      <Player
        component={CallReel}
        inputProps={props}
        durationInFrames={callReelFrames(props.transcript_turns.length)}
        fps={CALL_REEL_FPS}
        compositionWidth={CALL_REEL_WIDTH}
        compositionHeight={CALL_REEL_HEIGHT}
        style={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }}
        acknowledgeRemotionLicense
        controls
        loop
        autoPlay
      />
    </div>
  );
}

export function CoverageReelPlayer(props: CoverageReelProps) {
  return (
    <div className="mx-auto max-w-[720px] overflow-hidden rounded-2xl bg-white shadow-card">
      <Player
        component={CoverageReel}
        inputProps={props}
        durationInFrames={COVERAGE_REEL_DURATION}
        fps={COVERAGE_REEL_FPS}
        compositionWidth={COVERAGE_REEL_WIDTH}
        compositionHeight={COVERAGE_REEL_HEIGHT}
        style={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }}
        acknowledgeRemotionLicense
        controls
        loop
        autoPlay
      />
    </div>
  );
}
