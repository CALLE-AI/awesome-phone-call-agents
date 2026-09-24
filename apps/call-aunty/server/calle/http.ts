/**
 * Backward-compatible HTTP exports. The hardened client validates provider origin,
 * requires HTTPS, and rejects redirects before a bearer token can be forwarded.
 */
export {
  secureCalleHttp as calleHttp,
  unwrapSecureCall as unwrapCalleCall,
  unwrapSecureEventPage as unwrapCalleEventPage,
  unwrapSecurePayload as unwrapCallePayload,
} from "./http-secure";
