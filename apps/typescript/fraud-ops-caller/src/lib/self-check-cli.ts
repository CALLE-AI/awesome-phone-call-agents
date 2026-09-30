import "../../scripts/register-server-only-stub.mjs";
import { runSelfCheck } from "./self-check";

runSelfCheck()
  .then(() => {
    console.log("ok: self-check");
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
