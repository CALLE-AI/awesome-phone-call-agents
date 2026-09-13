// Shift seeded demo history so the newest outcome reads as recent instead of
// tripping the dashboard's staleness window. Runs once, right after the seed
// copy on first boot of an empty volume; real sweeps take over from there.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "baselines";
const target = Date.now() - 2 * 60 * 60 * 1000;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".history.json")) continue;
  const path = join(dir, name);
  const history = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(history) || history.length === 0) continue;
  const newest = Math.max(...history.map((outcome) => Date.parse(outcome.at)));
  const shift = target - newest;
  for (const outcome of history) {
    outcome.at = new Date(Date.parse(outcome.at) + shift).toISOString();
  }
  writeFileSync(path, JSON.stringify(history, null, 2));
}
