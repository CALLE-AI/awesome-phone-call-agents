import { type DynamicModule, Module } from "@nestjs/common";

import {
  SystemHealthModule,
  type SystemHealthModuleDependencies,
} from "./system-health/system-health.module.js";
import {
  ObservationModule,
  type ObservationModuleDependencies,
} from "./observations/observation.module.js";
import { FleetModule, type FleetModuleDependencies } from "./fleet/fleet.module.js";

@Module({})
export class AppModule {
  public static register(
    systemHealth?: SystemHealthModuleDependencies,
    observation?: ObservationModuleDependencies,
    fleet?: FleetModuleDependencies,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...(systemHealth === undefined ? [] : [SystemHealthModule.register(systemHealth)]),
        ...(observation === undefined ? [] : [ObservationModule.register(observation)]),
        ...(fleet === undefined ? [] : [FleetModule.register(fleet)]),
      ],
    };
  }
}
