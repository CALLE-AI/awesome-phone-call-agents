/**
 * Loads .env as the single source of truth for local configuration.
 *
 * Imported first (before any module that reads process.env) so that ESM import
 * hoisting can't cause env to be read before it's loaded.
 *
 * Locally, override:true means values in a .env file win over any stale
 * variables already present in the shell environment (e.g. leftover exports
 * from a previous run). In a hosted environment (Render, etc.) there is no
 * .env file, so platform-provided environment variables are used as-is.
 */
import { existsSync } from "node:fs";
import dotenv from "dotenv";

if (existsSync(".env")) {
  dotenv.config({ override: true });
}
