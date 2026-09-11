"use strict";
// Existing npm commands remain supported. Python owns the shared browser harness.
const {spawnSync} = require("node:child_process");
const path = require("node:path");
module.exports = function run(script) {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, [path.join(__dirname, script), ...process.argv.slice(2)], {stdio:"inherit", cwd:path.join(__dirname,".."), env:process.env});
  if (result.error) { console.error(result.error.message); process.exit(1); }
  process.exit(result.status === null ? 1 : result.status);
};
