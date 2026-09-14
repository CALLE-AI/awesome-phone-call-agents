import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Application root, resolved relative to this module so it works both when
 * running from `src/` (tsx) and from `dist/` (compiled). Both live one level
 * below the app root.
 */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const FIXTURES_DIR = resolve(APP_ROOT, "fixtures");
