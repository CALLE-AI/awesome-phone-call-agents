export interface Clock {
  now(): string;
}

export class SystemClock implements Clock {
  public now(): string {
    return new Date().toISOString();
  }
}
