export type TurnLatency = Readonly<{
  milliseconds: number;
  measuredAt: string;
  turn: number;
}>;

export class RealtimeLatencyTracker {
  private speechStoppedAt: number | undefined;
  private turn = 0;

  recordTransportEvent(eventType: string, now = performance.now()): TurnLatency | undefined {
    if (eventType === "input_audio_buffer.speech_stopped") {
      this.speechStoppedAt = now;
      return undefined;
    }

    const isFirstAudio =
      eventType === "output_audio_buffer.started" || eventType === "response.output_audio.delta";
    if (!isFirstAudio || this.speechStoppedAt === undefined) {
      return undefined;
    }

    const milliseconds = Math.max(0, Math.round(now - this.speechStoppedAt));
    this.speechStoppedAt = undefined;
    this.turn += 1;
    return { milliseconds, measuredAt: new Date().toISOString(), turn: this.turn };
  }

  reset(): void {
    this.speechStoppedAt = undefined;
    this.turn = 0;
  }
}
