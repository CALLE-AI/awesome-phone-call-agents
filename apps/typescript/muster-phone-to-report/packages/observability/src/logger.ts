import { trace } from "@opentelemetry/api";
import pino, { type DestinationStream, type Logger } from "pino";

import type { LoggerPort, SafeLogBindings, SafeLogEvent } from "@muster/application";

import { sanitizeLogBindings, sanitizeLogEvent } from "./redaction.js";

interface ActiveTrace {
  readonly traceId: string;
  readonly spanId: string;
}

export interface PinoLoggerOptions {
  readonly destination?: StructuredLogDestination;
  readonly bindings: SafeLogBindings;
  readonly level?: "debug" | "info" | "warn" | "error";
  readonly activeTrace?: () => ActiveTrace | undefined;
}

export interface StructuredLogDestination {
  write(message: string): unknown;
}

function currentTrace(): ActiveTrace | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext === undefined
    ? undefined
    : { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

class PinoLoggerAdapter implements LoggerPort {
  public constructor(
    private readonly logger: Logger,
    private readonly activeTrace: () => ActiveTrace | undefined,
  ) {}

  private fields(event: SafeLogEvent | Record<string, unknown>): Record<string, unknown> {
    const active = this.activeTrace();
    return {
      ...sanitizeLogEvent(event as Record<string, unknown>),
      ...(active === undefined ? {} : active),
    };
  }

  public debug(event: SafeLogEvent): void {
    this.logger.debug(this.fields(event));
  }

  public info(event: SafeLogEvent): void {
    this.logger.info(this.fields(event));
  }

  public warn(event: SafeLogEvent): void {
    this.logger.warn(this.fields(event));
  }

  public error(event: SafeLogEvent): void {
    this.logger.error(this.fields(event));
  }

  public child(bindings: SafeLogBindings): LoggerPort {
    return new PinoLoggerAdapter(
      this.logger.child(sanitizeLogBindings(bindings as Record<string, unknown>)),
      this.activeTrace,
    );
  }
}

export interface PinoLoggerRuntime {
  readonly logger: LoggerPort;
  close(): Promise<void>;
}

function createRootPinoLogger(options: PinoLoggerOptions): Logger {
  return pino(
    {
      level: options.level ?? "info",
      base: sanitizeLogBindings(options.bindings as Record<string, unknown>),
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          "authorization",
          "cookie",
          "set-cookie",
          "password",
          "token",
          "secret",
          "body",
          "payload",
          "job.data",
          "error.message",
          "error.stack",
        ],
        censor: "[REDACTED]",
      },
    },
    options.destination as DestinationStream | undefined,
  );
}

export function createPinoLoggerRuntime(options: PinoLoggerOptions): PinoLoggerRuntime {
  const rootLogger = createRootPinoLogger(options);
  let closed = false;
  return Object.freeze({
    logger: new PinoLoggerAdapter(rootLogger, options.activeTrace ?? currentTrace),
    close: async () => {
      if (closed) return;
      await new Promise<void>((resolve, reject) => {
        rootLogger.flush((error?: Error) => {
          if (error === undefined) resolve();
          else reject(new Error("Structured logger flush failed"));
        });
      });
      closed = true;
    },
  });
}

export function createPinoLogger(options: PinoLoggerOptions): LoggerPort {
  return createPinoLoggerRuntime(options).logger;
}
