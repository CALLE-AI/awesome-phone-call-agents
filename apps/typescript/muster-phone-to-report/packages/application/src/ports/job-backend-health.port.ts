import type { DependencyReadiness } from "./database-health.port.js";

export interface JobBackendHealthPort {
  getReadiness(): Promise<DependencyReadiness>;
}
