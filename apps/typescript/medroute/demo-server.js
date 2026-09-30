import { join } from "node:path";

// A judge-safe entry point: never load or honor live-call credentials, and
// keep demonstration history separate from normal local app data.
delete process.env.CALLE_API_KEY;
delete process.env.MEDROUTE_ACCESS_TOKEN;
process.env.MEDROUTE_ENV = "development";
process.env.MEDROUTE_DATA_DIR = process.env.MEDROUTE_DEMO_DATA_DIR || join(process.cwd(), "data", "demo");

await import("./server.js");
