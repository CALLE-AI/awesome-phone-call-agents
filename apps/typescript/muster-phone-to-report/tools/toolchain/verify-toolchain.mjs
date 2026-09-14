import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const requiredNodeVersion = "24.18.0";
const requiredPnpmVersion = "11.20.0";

/**
 * @param {{ readonly nodeVersion: string; readonly pnpmVersion: string }} input
 * @returns {readonly { readonly code: string; readonly message: string }[]}
 */
export function inspectToolchain(input) {
  const violations = [];
  const nodeVersion = input.nodeVersion.replace(/^v/u, "");
  if (nodeVersion !== requiredNodeVersion) {
    violations.push({
      code: "toolchain/node-version",
      message: `Node.js ${requiredNodeVersion} is required; received ${nodeVersion}`,
    });
  }
  if (input.pnpmVersion !== requiredPnpmVersion) {
    violations.push({
      code: "toolchain/pnpm-version",
      message: `pnpm ${requiredPnpmVersion} is required; received ${input.pnpmVersion}`,
    });
  }
  return violations;
}

/** @returns {string} */
function activePnpmVersion() {
  const userAgent = process.env["npm_config_user_agent"] ?? "";
  return /(?:^|\s)pnpm\/([^\s]+)/u.exec(userAgent)?.[1] ?? "unknown";
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url;

if (isMain) {
  const violations = inspectToolchain({
    nodeVersion: process.versions.node,
    pnpmVersion: activePnpmVersion(),
  });
  if (violations.length > 0) {
    process.stderr.write(`${violations.map(({ message }) => message).join("\n")}\n`);
    process.exitCode = 1;
  }
}
