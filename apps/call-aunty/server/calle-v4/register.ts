import type { Express } from "express";
import { loadCalleV4Config } from "./config";
import { CalleProvider } from "./client";
import { DemoCalleProvider } from "./demo-provider";
import { FallbackCalleProvider } from "./fallback-provider";
import { MemoryCallRepository, type CallRepository } from "./repository";
import { CallService } from "./service";
import { createCalleRouter, webhookHandler } from "./routes";
import type { Provider } from "./types";
import { createDrizzleCallRepository } from "./drizzle-repository";

export type CalleV4Runtime = {
  service: CallService;
  repo: CallRepository;
  provider: Provider;
};

let runtime: CalleV4Runtime | null = null;

export function getCalleV4Runtime(): CalleV4Runtime {
  if (runtime) return runtime;
  const config = loadCalleV4Config();
  const live = new CalleProvider(config);
  const provider: Provider = config.demoMode || !config.apiKey
    ? new DemoCalleProvider()
    : new FallbackCalleProvider(live, new DemoCalleProvider());
  const repo = createDrizzleCallRepository() ?? new MemoryCallRepository();
  const service = new CallService(provider, repo, config);
  runtime = { service, repo, provider };
  return runtime;
}

/** Test-only: replace the process singleton. */
export function setCalleV4Runtime(next: CalleV4Runtime | null): void {
  runtime = next;
}

export function registerCalleV4Routes(app: Express): void {
  const config = loadCalleV4Config();
  const { service, repo, provider } = getCalleV4Runtime();

  app.post("/api/calle/webhooks", webhookHandler(repo, config.webhookSecret));
  app.use("/api/calle", createCalleRouter({ service, repo, provider, config }));
}
