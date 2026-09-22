/**
 * Backward-compatible export. The legacy unauthenticated implementation was retired;
 * all imports now resolve to the hardened operator gateway.
 */
export { hardenedCalleRouter as calleRouter } from "./router-hardened";
