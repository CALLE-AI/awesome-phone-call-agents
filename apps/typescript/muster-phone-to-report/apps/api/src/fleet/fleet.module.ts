import { type DynamicModule, Module } from "@nestjs/common";

import type { GetFleetHealth, LoggerPort } from "@muster/application";

import {
  FleetController,
  type FleetHttpTelemetry,
  type FleetRequestAuthorizer,
  FLEET_TOKENS,
} from "./fleet.controller.js";

export interface FleetModuleDependencies {
  readonly getFleetHealth: Pick<GetFleetHealth, "execute">;
  readonly logger: LoggerPort;
  readonly maxEndpoints: number;
  readonly requestAuthorizer: FleetRequestAuthorizer;
  readonly retryAfterSeconds: number;
  readonly telemetry: FleetHttpTelemetry;
}

@Module({})
export class FleetModule {
  public static register(dependencies: FleetModuleDependencies): DynamicModule {
    return {
      module: FleetModule,
      controllers: [FleetController],
      providers: [
        { provide: FLEET_TOKENS.getFleetHealth, useValue: dependencies.getFleetHealth },
        { provide: FLEET_TOKENS.logger, useValue: dependencies.logger },
        { provide: FLEET_TOKENS.maxEndpoints, useValue: dependencies.maxEndpoints },
        { provide: FLEET_TOKENS.requestAuthorizer, useValue: dependencies.requestAuthorizer },
        { provide: FLEET_TOKENS.retryAfterSeconds, useValue: dependencies.retryAfterSeconds },
        { provide: FLEET_TOKENS.telemetry, useValue: dependencies.telemetry },
      ],
    };
  }
}
