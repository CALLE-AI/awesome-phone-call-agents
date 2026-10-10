import { loadConfig } from "./config.js";
import { createEngine } from "./engine.js";
import { buildServer } from "./http.js";

const config = loadConfig();
const engine = createEngine(config);
const app = await buildServer(config, engine);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
app.log.info(`Incident Commander listening on http://localhost:${config.PORT}`);
await engine.resumeOpenCalls();

if (config.ENABLE_ALARM_POLLER && config.CW_ALARM_NAME) {
  const tick = async () => {
    try {
      await engine.pollAlarms();
    } catch (error) {
      app.log.error(error);
    }
  };
  await tick();
  setInterval(tick, 30_000);
}
