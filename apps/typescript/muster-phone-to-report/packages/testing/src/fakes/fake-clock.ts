import type { Clock } from "@muster/application";

export class FakeClock implements Clock {
  public constructor(private currentTime: string) {}

  public now(): string {
    return this.currentTime;
  }

  public set(instant: string): void {
    this.currentTime = instant;
  }
}
