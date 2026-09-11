import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHtmlReport } from "./html-report.js";
import { loadReplay } from "./replay.js";
import { EXIT_CODE, type ExitCode } from "./result.js";
import { loadTestCase } from "./test-case.js";

export async function runCli(args: string[]): Promise<ExitCode> {
  try {
    if (args[0] !== "replay" || !args[1]) {
      process.stderr.write(
        "Usage: callsuite replay <sanitized-fixture.json> [--test-case <test-case.json>] [--json] [--html <report.html>]\n",
      );
      return EXIT_CODE.error;
    }

    const fixturePath = resolve(args[1]);
    const json = args.includes("--json");
    const htmlIndex = args.indexOf("--html");
    const htmlArgument = htmlIndex === -1 ? undefined : args[htmlIndex + 1];
    if (htmlIndex !== -1 && (!htmlArgument || htmlArgument.startsWith("--"))) {
      throw new Error("--html requires an output path.");
    }
    const testCaseIndex = args.indexOf("--test-case");
    const testCaseArgument = testCaseIndex === -1 ? undefined : args[testCaseIndex + 1];
    if (testCaseIndex !== -1 && (!testCaseArgument || testCaseArgument.startsWith("--"))) {
      throw new Error("--test-case requires a test-case JSON path.");
    }

    const testCase = testCaseArgument ? await loadTestCase(resolve(testCaseArgument)) : undefined;
    const output = await loadReplay(fixturePath, testCase ? { testCase } : {});
    if (htmlArgument) {
      const htmlPath = resolve(htmlArgument);
      await mkdir(dirname(htmlPath), { recursive: true });
      await writeFile(htmlPath, renderHtmlReport(output), "utf8");
    }

    if (json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          `Replay: ${output.fixture.id}`,
          output.testCase ? `Test case: ${output.testCase.id} (${output.testCase.totals.met}/${output.testCase.assertions.length} assertions met)` : null,
          `Verdict: ${output.result.verdict}`,
          `Exit code: ${output.result.exitCode}`,
          `Reason: ${output.result.reason}`,
          htmlArgument ? `HTML report: ${resolve(htmlArgument)}` : null,
        ]
          .filter(Boolean)
          .join("\n") + "\n",
      );
    }

    return output.result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CallSuite error: ${message}\n`);
    return EXIT_CODE.error;
  }
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
