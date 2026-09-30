import { type DynamicModule, Module } from "@nestjs/common";

import type { GetSystemHealth, HealthAccessPolicy, LoggerPort } from "@muster/application";
import {
  SystemHealthController,
  type SystemHealthHttpTelemetry,
  type SystemHealthRequestAuthorizer,
  SYSTEM_HEALTH_TOKENS,
} from "./system-health.controller.js";

export interface SystemHealthModuleDependencies {
  readonly accessPolicy: HealthAccessPolicy;
  readonly getSystemHealth: GetSystemHealth;
  readonly listenerScope: "loopback" | "non-loopback";
  readonly logger: LoggerPort;
  readonly requestAuthorizer: SystemHealthRequestAuthorizer;
  readonly telemetry: SystemHealthHttpTelemetry;
  readonly readinessTimeoutMs: number;
}

@Module({})
export class SystemHealthModule {
  public static register(dependencies: SystemHealthModuleDependencies): DynamicModule {
    return {
      module: SystemHealthModule,
      controllers: [SystemHealthController],
      providers: [
        { provide: SYSTEM_HEALTH_TOKENS.accessPolicy, useValue: dependencies.accessPolicy },
        { provide: SYSTEM_HEALTH_TOKENS.getSystemHealth, useValue: dependencies.getSystemHealth },
        { provide: SYSTEM_HEALTH_TOKENS.listenerScope, useValue: dependencies.listenerScope },
        { provide: SYSTEM_HEALTH_TOKENS.logger, useValue: dependencies.logger },
        {
          provide: SYSTEM_HEALTH_TOKENS.requestAuthorizer,
          useValue: dependencies.requestAuthorizer,
        },
        { provide: SYSTEM_HEALTH_TOKENS.telemetry, useValue: dependencies.telemetry },
        {
          provide: SYSTEM_HEALTH_TOKENS.readinessTimeoutMs,
          useValue: dependencies.readinessTimeoutMs,
        },
      ],
    };
  }
}
