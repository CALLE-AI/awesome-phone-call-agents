export type DependencyReadiness = "ready" | "degraded" | "unknown";

export interface DatabaseHealthPort {
  getReadiness(): Promise<DependencyReadiness>;
}
