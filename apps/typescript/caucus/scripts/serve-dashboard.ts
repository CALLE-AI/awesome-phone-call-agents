/** Dev server for the operator dashboard over a case DB. Usage: npx tsx scripts/serve-dashboard.ts [db] [port] */
import { startDashboard } from "../src/dashboard.js";
const db = process.argv[2] ?? "demo.db";
const port = Number(process.argv[3] ?? 8787);
startDashboard({ dbPath: db, port });
console.log(`caucus dashboard: http://localhost:${port}/ (db: ${db})`);
