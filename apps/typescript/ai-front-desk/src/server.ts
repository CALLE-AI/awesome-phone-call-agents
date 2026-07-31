import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./config/env.js";
import { api } from "./routes/index.js";
import { startScheduler } from "./cron/scheduler.js";

const app = express();
app.use(express.json());

app.use("/api", api);

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
app.use(express.static(webDist));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(webDist, "index.html"), (error) => {
    if (error) response.status(404).send("Dashboard not built yet. Run: npm run web:build");
  });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("[error]", error);
  const message = error instanceof Error ? error.message : "internal_error";
  response.status(500).json({ error: message });
});

app.listen(env.PORT, () => {
  console.log(`AI Front Desk listening on http://localhost:${env.PORT} (dry run: ${env.CALLE_DRY_RUN})`);
  startScheduler();
});
