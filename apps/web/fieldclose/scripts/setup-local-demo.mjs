import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { prepareLocalDemoEnvironment } from "../src/config/local-demo-setup.ts";

const localEnvironmentPath = resolve(process.cwd(), ".env.local");
const exampleEnvironmentPath = resolve(process.cwd(), ".env.example");
const sourcePath = existsSync(localEnvironmentPath)
  ? localEnvironmentPath
  : exampleEnvironmentPath;
const source = readFileSync(sourcePath, "utf8");
const result = prepareLocalDemoEnvironment(source, () =>
  randomBytes(32).toString("base64"),
);

writeFileSync(localEnvironmentPath, result.content, {
  encoding: "utf8",
  mode: 0o600,
});

if (result.updatedKeys.length === 0) {
  console.log("Local fake-only demo configuration is already ready.");
} else {
  console.log(
    `Local fake-only demo configuration updated: ${result.updatedKeys.join(", ")}.`,
  );
}

console.log("Secret values were written only to the ignored .env.local file.");
