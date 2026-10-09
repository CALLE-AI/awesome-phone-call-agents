"use client";

import {
  CallReel,
  CALL_REEL_FPS,
  CALL_REEL_HEIGHT,
  CALL_REEL_WIDTH,
  ScopeReel,
  SCOPE_REEL_FPS,
  SCOPE_REEL_HEIGHT,
  SCOPE_REEL_WIDTH,
  scopeReelFrames,
  VerificationReel,
  VERIFICATION_REEL_DURATION,
  VERIFICATION_REEL_FPS,
  VERIFICATION_REEL_HEIGHT,
  VERIFICATION_REEL_WIDTH,
  callReelFrames,
  type CallReelProps,
  type ScopeReelProps,
  type VerificationReelProps,
} from "@caller-ai/reel";
import { Player } from "@remotion/player";

export function CallReelPlayer({ compact, ...props }: CallReelProps & { compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-card ${compact ? "mx-auto max-w-[720px]" : ""}`}>
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

export function ScopeReelPlayer(props: ScopeReelProps) {
  return (
    <div className="mx-auto max-w-[720px] overflow-hidden rounded-2xl bg-white shadow-card">
      <Player
        component={ScopeReel}
        inputProps={props}
        durationInFrames={scopeReelFrames(props.transcript_turns?.length ?? 0)}
        fps={SCOPE_REEL_FPS}
        compositionWidth={SCOPE_REEL_WIDTH}
        compositionHeight={SCOPE_REEL_HEIGHT}
        style={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }}
        acknowledgeRemotionLicense
        controls
        loop
        autoPlay
      />
    </div>
  );
}

export function VerificationReelPlayer(props: VerificationReelProps) {
  return (
    <div className="mx-auto max-w-[720px] overflow-hidden rounded-2xl bg-white shadow-card">
      <Player
        component={VerificationReel}
        inputProps={props}
        durationInFrames={VERIFICATION_REEL_DURATION}
        fps={VERIFICATION_REEL_FPS}
        compositionWidth={VERIFICATION_REEL_WIDTH}
        compositionHeight={VERIFICATION_REEL_HEIGHT}
        style={{ width: "100%", height: "auto", aspectRatio: "16 / 9" }}
        acknowledgeRemotionLicense
        controls
        loop
        autoPlay
      />
    </div>
  );
}