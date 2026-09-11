/**
 * Timing metrics from transcript turns.
 *
 * `secondsToAnswer` is the offset of the first user turn — how long the line
 * took to produce a voice. `secondsToFirstResponse` is how long that voice
 * took after our caller first spoke; when the callee spoke first the two
 * coincide. Offsets can be null on the wire (no parseable timestamp);
 * null-offset turns still count toward `turnCount` but never into metrics.
 */

import type { TranscriptTurn } from "./types.js";

export interface TimingMetrics {
  secondsToAnswer: number | null;
  secondsToFirstResponse: number | null;
  turnCount: number;
}

export function extractTiming(turns: TranscriptTurn[]): TimingMetrics {
  let firstBot: number | null = null;
  let firstUser: number | null = null;
  for (const turn of turns) {
    if (turn.offsetSeconds === null) {
      continue;
    }
    if (turn.speaker === "bot" && firstBot === null) {
      firstBot = turn.offsetSeconds;
    }
    if (turn.speaker === "user" && firstUser === null) {
      firstUser = turn.offsetSeconds;
    }
  }
  const secondsToFirstResponse =
    firstUser === null ? null : firstBot === null || firstUser <= firstBot ? firstUser : firstUser - firstBot;
  return { secondsToAnswer: firstUser, secondsToFirstResponse, turnCount: turns.length };
}
