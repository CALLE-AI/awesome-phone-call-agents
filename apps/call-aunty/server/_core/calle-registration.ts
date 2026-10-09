/**
 * Backward-compatible registration exports. Keeping these names prevents an older
 * bootstrap import from restoring the prior unauthenticated /api/calle route.
 */
export {
  registerHardenedCalleRoutes as registerCalleRoutes,
  registerHardenedCalleWebhook as registerCalleWebhook,
} from "./calle-registration-hardened";
