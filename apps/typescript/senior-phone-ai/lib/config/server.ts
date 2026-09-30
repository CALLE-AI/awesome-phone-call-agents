import "server-only";

import { parseRuntimeMode, readSecret, type RuntimeMode, type ServerEnvironment } from "./runtime";

export function getRuntimeMode(environment: ServerEnvironment = process.env): RuntimeMode {
  return parseRuntimeMode(environment);
}

export function requireSecret(name: string, environment: ServerEnvironment = process.env): string {
  return readSecret(name, environment);
}
