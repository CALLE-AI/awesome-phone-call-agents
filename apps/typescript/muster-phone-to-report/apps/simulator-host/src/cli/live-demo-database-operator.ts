import {
  createLiveDemoDatabasePaths,
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  liveDemoDatabaseDisposeOutput,
  liveDemoDatabaseStartOutput,
  parseLiveDemoDatabaseCommand,
} from "./live-demo-database-contract.js";
import type { LiveDemoDatabaseDisposeResult } from "./live-demo-database-dispose.js";
import type { LiveDemoDatabaseStartResult } from "./live-demo-database-start.js";

export interface LiveDemoDatabaseOperatorCommandInput {
  readonly argv: readonly string[];
  readonly repositoryRoot: string;
  readonly start: () => Promise<LiveDemoDatabaseStartResult>;
  readonly dispose: () => Promise<LiveDemoDatabaseDisposeResult>;
  readonly writeLine: (line: string) => void;
}

export async function runLiveDemoDatabaseOperatorCommand(
  input: LiveDemoDatabaseOperatorCommandInput,
): Promise<0 | 1> {
  try {
    const command = parseLiveDemoDatabaseCommand(input.argv);
    if (command === "start") {
      const result = await input.start();
      if (result.outcome !== "ready") throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
      for (const line of liveDemoDatabaseStartOutput(
        createLiveDemoDatabasePaths(input.repositoryRoot),
      )) {
        input.writeLine(line);
      }
      return 0;
    }

    const result = await input.dispose();
    if (result.outcome !== "disposed") throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    for (const line of liveDemoDatabaseDisposeOutput()) input.writeLine(line);
    return 0;
  } catch {
    input.writeLine(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    return 1;
  }
}
