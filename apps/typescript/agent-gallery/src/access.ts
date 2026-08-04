/**
 * The operator access code transport, shared by the browser and the server.
 *
 * The code itself never lives here. The browser holds what the operator typed
 * for the length of one session and sends it on each call-touching request; the
 * expected value exists only as a deployment environment variable, and the
 * server compares them. Nothing is persisted on either side.
 */

/** Request header carrying the operator access code. */
export const ACCESS_CODE_HEADER = "x-access-code";
