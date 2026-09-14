// ============================================================================
// MedRoute — DOM Cache & Utilities (shared across modules)
// ============================================================================

/**
 * @typedef {Object} DomCache
 * @property {HTMLElement} pharmacies
 * @property {HTMLInputElement} accessToken
 * @property {HTMLElement} operatorAuth
 * @property {HTMLButtonElement} run
 * @property {HTMLInputElement} consent
 * @property {HTMLInputElement} live
 * @property {HTMLElement} liveCallNote
 * @property {HTMLInputElement} medicine
 * @property {HTMLInputElement} strengthValue
 * @property {HTMLSelectElement} strengthUnit
 * @property {HTMLSelectElement} dosageForm
 * @property {HTMLElement} hint
 * @property {HTMLElement} output
 * @property {HTMLElement} badge
 * @property {HTMLElement} results
 * @property {HTMLElement} historyCount
 * @property {HTMLElement} historyList
 * @property {HTMLButtonElement} resetDemo
 * @property {HTMLElement} analyticsContent
 * @property {HTMLElement} workspace
 * @property {HTMLElement} analytics
 * @property {HTMLElement} callOverlay
 * @property {HTMLDialogElement} messageDialog
 * @property {HTMLElement} messageEyebrow
 * @property {HTMLElement} messageTitle
 * @property {HTMLElement} messageBody
 * @property {HTMLButtonElement} messageCancel
 * @property {HTMLButtonElement} messageAction
 * @property {HTMLElement} home
 */

/** @type {DomCache} Cached DOM element references to avoid repeated querySelector calls. */
export const dom = {
  pharmacies: document.querySelector("#pharmacies"),
  accessToken: /** @type {HTMLInputElement} */ (document.querySelector("#access-token")),
  operatorAuth: document.querySelector("#operator-auth"),
  run: /** @type {HTMLButtonElement} */ (document.querySelector("#run")),
  consent: /** @type {HTMLInputElement} */ (document.querySelector("#consent")),
  live: /** @type {HTMLInputElement} */ (document.querySelector("#live")),
  liveCallNote: document.querySelector("#live-call-note"),
  medicine: /** @type {HTMLInputElement} */ (document.querySelector("#medicine")),
  strengthValue: /** @type {HTMLInputElement} */ (document.querySelector("#strength-value")),
  strengthUnit: /** @type {HTMLSelectElement} */ (document.querySelector("#strength-unit")),
  dosageForm: /** @type {HTMLSelectElement} */ (document.querySelector("#dosage-form")),
  hint: document.querySelector("#hint"),
  output: document.querySelector("#output"),
  badge: document.querySelector("#badge"),
  results: document.querySelector("#results"),
  historyCount: document.querySelector("#history-count"),
  historyList: document.querySelector("#history-list"),
  resetDemo: /** @type {HTMLButtonElement} */ (document.querySelector("#reset-demo")),
  analyticsContent: document.querySelector("#analytics-content"),
  workspace: document.querySelector("#workspace"),
  analytics: document.querySelector("#analytics"),
  callOverlay: document.querySelector("#call-overlay"),
  messageDialog: /** @type {HTMLDialogElement} */ (document.querySelector("#message-dialog")),
  messageEyebrow: document.querySelector("#message-eyebrow"),
  messageTitle: document.querySelector("#message-title"),
  messageBody: document.querySelector("#message-body"),
  messageCancel: /** @type {HTMLButtonElement} */ (document.querySelector("#message-cancel")),
  messageAction: /** @type {HTMLButtonElement} */ (document.querySelector("#message-action")),
  home: document.querySelector("#home"),
};

/**
 * Escape HTML special characters to prevent XSS when injecting into innerHTML.
 * @param {*} value - Value to escape (coerced to string).
 * @returns {string} HTML-safe escaped string.
 */
export function esc(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(value ?? "").replace(/[&<>"]/g, (char) => map[char]);
}
