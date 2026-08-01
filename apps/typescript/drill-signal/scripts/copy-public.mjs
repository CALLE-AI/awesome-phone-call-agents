import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "public"), { recursive: true });
cpSync(join(root, "public"), join(root, "dist", "public"), { recursive: true });
