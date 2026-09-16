import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import routes from "./src/routes.js";
import { DRY_RUN } from "./src/calleClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Relay listening on http://localhost:${PORT}`);
  console.log(
    DRY_RUN
      ? "Mode: DRY RUN — no real calls will be placed. Set CALLE_API_KEY and CALLE_DRY_RUN=false to go live."
      : "Mode: LIVE — real calls will be placed via CALL-E."
  );
});
