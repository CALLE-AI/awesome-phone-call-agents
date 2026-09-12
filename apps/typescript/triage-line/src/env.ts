/**
 * Loads .env as the single source of truth for configuration.
 *
 * Imported first (before any module that reads process.env) so that ESM import
 * hoisting can't cause env to be read before it's loaded. override:true means
 * values in .env win over any stale variables already present in the shell
 * environment — important because leftover exports (e.g. MAX_CONCURRENCY from a
 * previous run) would otherwise silently shadow the file.
 */
import dotenv from "dotenv";

dotenv.config({ override: true });
