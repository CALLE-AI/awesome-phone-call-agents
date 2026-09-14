// ============================================================================
// MedRoute — API Client Module
// All server communication: check submission, history, analytics, transcripts.
// ============================================================================

/**
 * @typedef {Object} Pharmacy
 * @property {string} name
 * @property {string} phone
 * @property {string} distanceKm
 */

/**
 * @typedef {Object} CheckRequestBody
 * @property {string} medicine
 * @property {string} strength
 * @property {{strengthValue: string, strengthUnit: string, form: string, releaseType: string, brand: string, requestedQuantity?: number}} [productRequest]
 * @property {Pharmacy[]} pharmacies
 * @property {boolean} confirmLive
 * @property {boolean} consentAcknowledged
 * @property {boolean} liveCallAcknowledged
 */

/**
 * @typedef {Object} SanitizedResult
 * @property {"in_stock"|"limited"|"out_of_stock"|"unknown"} stock_status
 * @property {string} price_range
 * @property {"ready_today"|"not_confirmed_today"|"unknown"} pickup_readiness
 * @property {string} hours
 * @property {string} substitution_available
 * @property {string} notes
 * @property {"high"|"medium"|"low"} confidence
 */

/**
 * @typedef {Object} CallResult
 * @property {string} pharmacy
 * @property {string} phone
 * @property {number} distanceKm
 * @property {SanitizedResult} result
 * @property {"live"|"demo"} mode
 * @property {string} [error]
 * @property {Array<{speaker: string, text: string, offsetSeconds: number|null}>} [transcript]
 */

/**
 * @typedef {Object} CheckRecord
 * @property {string} id
 * @property {string} createdAt
 * @property {"live"|"demo"} mode
 * @property {string} medicine
 * @property {string} strength
 * @property {CallResult[]} results
 */

/**
 * @typedef {Object} AnalyticsData
 * @property {number} totalRuns
 * @property {number} totalCalls
 * @property {number} liveRuns
 * @property {number} inStockRate
 * @property {Array<{medicine: string, count: number}>} topMedicines
 * @property {CheckRecord[]} recent
 */

/** @type {string} SessionStorage key for tracking in-flight live requests. */
const pendingLiveRequestKey = "medroute-pending-live-request";

/**
 * Build Authorization headers using the provided token.
 * @param {string} token - Bearer token value.
 * @returns {{Authorization: string}} Headers object.
 */
function authHeaders(token) {
  return { Authorization: `Bearer ${token.trim()}` };
}

/**
 * Submit a medicine availability check to the server.
 * Manages idempotency keys for live requests via sessionStorage.
 * @param {string} token - Current access token.
 * @param {CheckRequestBody} requestBody - Check request parameters.
 * @param {Function} [onProgress] - Receives read-only call phase updates.
 * @returns {Promise<CheckRecord>} The completed check record with results.
 * @throws {Error} If the server returns an error response.
 */
export async function apiCheck(token, requestBody, onProgress) {
  const requestFingerprint = JSON.stringify(requestBody);
  const isLive = requestBody.confirmLive;
  const savedRequest = isLive ? JSON.parse(sessionStorage.getItem(pendingLiveRequestKey) || "null") : null;
  const idempotencyKey = isLive
    ? (savedRequest?.fingerprint === requestFingerprint ? savedRequest.idempotencyKey : crypto.randomUUID())
    : null;

  if (isLive) {
    sessionStorage.setItem(pendingLiveRequestKey, JSON.stringify({ fingerprint: requestFingerprint, idempotencyKey }));
  }

  const stopProgress = isLive && onProgress ? observeCheckProgress(token, idempotencyKey, onProgress) : () => {};
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(token),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = response.status === 401
        ? "The operator access token does not match this server. Live calls require the server's MEDROUTE_ACCESS_TOKEN."
        : data.error;
      throw new Error(message);
    }

    if (isLive) sessionStorage.removeItem(pendingLiveRequestKey);
    return /** @type {CheckRecord} */ (data);
  } finally {
    stopProgress();
  }
}

/** Observe the existing request without submitting another call.
 * @param {string} token - Operator credential.
 * @param {string} key - Idempotency key of the running request.
 * @param {Function} onProgress - Receives provider phase updates.
 * @returns {Function} Stops polling and aborts any pending progress read.
 */
function observeCheckProgress(token, key, onProgress) {
  let stopped = false, controller;
  let timer = setTimeout(poll, 750);
  /** @returns {Promise<void>} Read a single progress update. */
  async function poll() {
    controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/check-progress", { headers: { ...authHeaders(token), "Idempotency-Key": key }, signal: controller.signal });
      if (response.ok) {
        const progress = await response.json();
        if (!stopped) onProgress(progress);
      }
    } catch { /* A progress read failure must not retry or cancel the call. */ }
    finally {
      clearTimeout(deadline);
      if (!stopped) timer = setTimeout(poll, 750);
    }
  }
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}

/**
 * Read public runtime capabilities so the interface never implies that a
 * simulated demo can place a telephone call.
 * @returns {Promise<{safeDemoMode: boolean, liveCallsAvailable: boolean, requiresOperatorToken: boolean}|null>} Runtime capabilities, or null when unavailable.
 */
export async function apiFetchRuntimeCapabilities() {
  try {
    const response = await fetch("/healthz");
    if (!response.ok) return null;
    const data = await response.json();
    return {
      safeDemoMode: data.safeDemoMode === true,
      liveCallsAvailable: data.liveCallsAvailable === true,
      requiresOperatorToken: data.requiresOperatorToken !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the actor's check history from the server.
 * @param {string} token - Current access token.
 * @returns {Promise<CheckRecord[]>} Array of historical records, or empty array on failure.
 */
export async function apiFetchHistory(token) {
  const response = await fetch("/api/history", { headers: authHeaders(token) });
  if (!response.ok) return [];
  const data = await response.json();
  return /** @type {CheckRecord[]} */ (data.history || []);
}

/**
 * Fetch aggregate analytics from the server.
 * @param {string} token - Current access token.
 * @returns {Promise<AnalyticsData|null>} Analytics data, or null on failure.
 */
export async function apiFetchAnalytics(token) {
  const response = await fetch("/api/analytics", { headers: authHeaders(token) });
  if (!response.ok) return null;
  return /** @type {Promise<AnalyticsData>} */ (response.json());
}

/**
 * Remove only locally stored demo runs. The endpoint is intentionally absent
 * in production, where completed runs form part of the audit record.
 * @param {string} token - Current access token.
 * @returns {Promise<{deleted: number}>} Number of demo records removed.
 * @throws {Error} If the reset cannot be completed.
 */
export async function apiResetDemoHistory(token) {
  const response = await fetch("/api/demo/reset", {
    method: "POST",
    headers: authHeaders(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not reset demo history.");
  return /** @type {{deleted: number}} */ (data);
}

/**
 * Download a transcript PDF and trigger a browser download.
 * @param {string} token - Current access token.
 * @param {string} url - API URL for the transcript PDF endpoint.
 * @returns {Promise<void>}
 * @throws {Error} If the download fails.
 */
export async function apiDownloadTranscript(token, url) {
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not download transcript.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "medroute-call-transcript.pdf";
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}
