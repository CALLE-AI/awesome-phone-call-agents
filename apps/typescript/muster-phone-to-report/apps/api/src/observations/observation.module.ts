import { type DynamicModule, Module } from "@nestjs/common";

import type { GetObservationOperation, LoggerPort } from "@muster/application";

import {
  ObservationController,
  type ObservationHttpTelemetry,
  type ObservationRequestAuthorizer,
  type ObservationRequestHandler,
  OBSERVATION_TOKENS,
} from "./observation.controller.js";

export interface ObservationModuleDependencies {
  readonly getObservationOperation: Pick<GetObservationOperation, "execute">;
  readonly logger: LoggerPort;
  readonly requestAuthorizer: ObservationRequestAuthorizer;
  readonly requestObservation: ObservationRequestHandler;
  readonly retryAfterSeconds: number;
  readonly telemetry: ObservationHttpTelemetry;
}

@Module({})
export class ObservationModule {
  public static register(dependencies: ObservationModuleDependencies): DynamicModule {
    return {
      module: ObservationModule,
      controllers: [ObservationController],
      providers: [
        {
          provide: OBSERVATION_TOKENS.getObservationOperation,
          useValue: dependencies.getObservationOperation,
        },
        { provide: OBSERVATION_TOKENS.logger, useValue: dependencies.logger },
        {
          provide: OBSERVATION_TOKENS.requestAuthorizer,
          useValue: dependencies.requestAuthorizer,
        },
        {
          provide: OBSERVATION_TOKENS.requestObservation,
          useValue: dependencies.requestObservation,
        },
        {
          provide: OBSERVATION_TOKENS.retryAfterSeconds,
          useValue: dependencies.retryAfterSeconds,
        },
        { provide: OBSERVATION_TOKENS.telemetry, useValue: dependencies.telemetry },
      ],
    };
  }
}
