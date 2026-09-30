import { serve } from "@hono/node-server";
import { createSimApp } from "./server";

const port = Number(process.env.CALLE_SIM_PORT ?? 4000);
const app = createSimApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[sim] fake CALL-E listening on http://localhost:${info.port}`);
  console.log("[sim] point CALLE_BASE_URL at this process; CALLE_LIVE stays 0");
});
