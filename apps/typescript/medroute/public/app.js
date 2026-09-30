// ============================================================================
// MedRoute — Client Application Entry Point
// Imports storage, API, and rendering modules. Manages state and event wiring.
// ============================================================================

import { dom } from "./js/dom.js";
import { loadSavedPharmacies, savePharmacies, loadAccessToken, saveAccessToken } from "./js/storage.js";
import { apiCheck, apiFetchRuntimeCapabilities, apiFetchHistory, apiDownloadTranscript, apiResetDemoHistory } from "./js/api.js";
import {
  setLiveCallOverlay,
  updateCallProgress,
  renderPharmacies,
  showResults,
  renderHistoryList,
  changeView as renderingChangeView,
  updateCtaMode,
} from "./js/rendering.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {import("./js/api.js").Pharmacy[]} Current pharmacy list. */
let pharmacies = loadSavedPharmacies();

/** @type {import("./js/api.js").CheckRecord[]} Saved check history loaded from the server. */
let history = [];

/** @type {string} Current operator access token. */
let accessToken = loadAccessToken();

/** @type {boolean} Whether this server explicitly reports safe simulated-demo mode. */
let safeDemoMode = false;

/** @type {boolean} Whether this server requires a user-supplied operator credential. */
let requiresOperatorToken = true;

// ---------------------------------------------------------------------------
// Access token persistence
// ---------------------------------------------------------------------------

dom.accessToken.value = accessToken;
dom.accessToken.addEventListener("input", () => {
  accessToken = dom.accessToken.value.trim();
  saveAccessToken(accessToken);
});

/**
 * Keep safe-demo mode honest: it simulates outcomes and never contacts a pharmacy.
 * @param {{safeDemoMode: boolean, liveCallsAvailable: boolean, requiresOperatorToken: boolean}|null} capabilities - Public server capabilities.
 * @returns {void}
 */
function applyRuntimeCapabilities(capabilities) {
  if (!capabilities) {
    dom.run.disabled = true;
    dom.live.disabled = true;
    document.querySelector("#calling-status").textContent = "Calling availability could not be verified. Refresh to try again.";
    return;
  }
  dom.run.disabled = false;
  requiresOperatorToken = capabilities.requiresOperatorToken;
  if (!requiresOperatorToken) {
    dom.operatorAuth.hidden = true;
    accessToken = "";
    dom.accessToken.value = "";
    saveAccessToken("");
  }
  safeDemoMode = capabilities.safeDemoMode;
  dom.live.checked = false;
  dom.live.disabled = !capabilities.liveCallsAvailable;
  dom.liveCallNote.textContent = capabilities.liveCallsAvailable
    ? "Enable to place real calls to your authorized pharmacy numbers."
    : "Unavailable on this server. Demo previews return simulated results.";
  updateCtaMode();
}

/**
 * Keep a demo animation visible long enough for a viewer to understand that it is simulated.
 * @param {number} milliseconds - Delay duration in milliseconds.
 * @returns {Promise<void>}
 */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Show a consistent, accessible in-app message instead of a browser alert.
 * @param {{eyebrow?: string, title: string, message: string, tone?: "notice"|"error"|"success", actionLabel?: string, cancelLabel?: string, onClose?: (value: string) => void}} options - Dialog content and behavior.
 * @returns {void}
 */
function showMessage({ eyebrow = "ACTION NEEDED", title, message, tone = "notice", actionLabel = "Got it", cancelLabel = "", onClose }) {
  const dialog = dom.messageDialog;
  if (!dialog || typeof dialog.showModal !== "function") {
    window.alert(`${title}\n\n${message}`);
    return;
  }

  dom.messageEyebrow.textContent = eyebrow;
  dom.messageTitle.textContent = title;
  dom.messageBody.textContent = message;
  dom.messageAction.textContent = actionLabel;
  dom.messageCancel.textContent = cancelLabel;
  dom.messageCancel.hidden = !cancelLabel;
  dialog.dataset.tone = tone;
  const symbol = dialog.querySelector(".message-symbol");
  if (symbol) symbol.textContent = tone === "success" ? "✓" : tone === "error" ? "!" : "i";
  dialog.addEventListener("close", () => onClose?.(dialog.returnValue), { once: true });
  if (!dialog.open) dialog.showModal();
  setTimeout(() => dom.messageAction.focus(), 0);
}

/**
 * Ask for confirmation with the MedRoute dialog.
 * @param {{title: string, message: string, confirmLabel: string}} options - Confirmation content.
 * @returns {Promise<boolean>} Whether the primary confirmation action was selected.
 */
function confirmMessage({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    showMessage({
      eyebrow: "PLEASE CONFIRM",
      title,
      message,
      actionLabel: confirmLabel,
      cancelLabel: "Cancel",
      onClose: (value) => resolve(value === "confirm"),
    });
  });
}

/**
 * Display a recoverable error in the standard message dialog.
 * @param {string} message - Safe message to show to the user.
 * @returns {void}
 */
function showError(message) {
  showMessage({ eyebrow: "SOMETHING NEEDS ATTENTION", title: "We couldn’t complete that", message, tone: "error" });
}

// ---------------------------------------------------------------------------
// View switching (delegates to rendering, passes token)
// ---------------------------------------------------------------------------

/**
 * Switch between workspace, results and analytics views.
 * @param {"workspace"|"results"|"analytics"} view - Target view.
 * @returns {Promise<void>}
 */
async function changeView(view) {
  await renderingChangeView(view, accessToken);
}

// ---------------------------------------------------------------------------
// Event handlers — Pharmacy form
// ---------------------------------------------------------------------------

/**
 * Sync a pharmacy row's input values back into the pharmacies array.
 * @param {number} index - Index of the pharmacy in the array.
 * @param {HTMLElement} row - The .pharmacy DOM row element.
 * @returns {void}
 */
function syncPharmacyFromRow(index, row) {
  const inputs = row.querySelectorAll("input");
  pharmacies[index] = {
    name: inputs[0].value,
    phone: inputs[1].value,
    distanceKm: inputs[2].value,
  };
  savePharmacies(pharmacies);
}

dom.pharmacies.addEventListener("input", (e) => {
  const row = /** @type {HTMLElement} */ (e.target).closest(".pharmacy");
  if (!row) return;
  const index = [...dom.pharmacies.children].indexOf(row);
  syncPharmacyFromRow(index, row);
});

dom.pharmacies.addEventListener("click", (e) => {
  if (/** @type {HTMLElement} */ (e.target).dataset.remove === undefined) return;
  pharmacies.splice(Number(/** @type {HTMLElement} */ (e.target).dataset.remove), 1);
  savePharmacies(pharmacies);
  try { renderPharmacies(pharmacies); }
  catch (error) { showError(`Could not update the pharmacy list: ${/** @type {Error} */ (error).message}`); }
});

document.querySelector("#add").onclick = () => {
  pharmacies.push({ name: "", phone: "", distanceKm: "" });
  savePharmacies(pharmacies);
  try { renderPharmacies(pharmacies); }
  catch (error) { showError(`Could not update the pharmacy list: ${/** @type {Error} */ (error).message}`); }
};

// ---------------------------------------------------------------------------
// Event handlers — Run check
// ---------------------------------------------------------------------------

dom.run.onclick = async () => {
  if (!dom.consent.checked) {
    showMessage({
      eyebrow: "ONE QUICK STEP",
      title: "Confirm you’re authorized",
      message: "Tick the authorization box below to confirm you may contact the selected pharmacies. Then you can run the check.",
      actionLabel: "Show me",
      onClose: () => dom.consent.focus(),
    });
    return;
  }
  if (requiresOperatorToken && !dom.accessToken.value.trim()) {
    showMessage({
      eyebrow: "ACCESS REQUIRED",
      title: "Enter your operator token",
      message: "Your MedRoute administrator provides this token for this server.",
      actionLabel: "Show me",
      onClose: () => dom.accessToken.focus(),
    });
    return;
  }

  const isLive = dom.live.checked;
  const simulateCheck = safeDemoMode;
  const medicine = dom.medicine.value;
  const strength = [dom.strengthValue.value, dom.strengthUnit.value, dom.dosageForm.value]
    .filter(Boolean)
    .join(" ");

  dom.run.disabled = true;
  dom.run.textContent = isLive ? "Live calls in progress…" : simulateCheck ? "Simulating checks…" : "Preparing checks…";
  const overlayStartedAt = Date.now();
  if (isLive || simulateCheck) setLiveCallOverlay(true, pharmacies, medicine, simulateCheck);
  let checkCompleted = false;

  try {
    /** @type {import("./js/api.js").CheckRequestBody["productRequest"]} */
    const requestProduct = {
      strengthValue: dom.strengthValue.value,
      strengthUnit: dom.strengthUnit.value,
      form: dom.dosageForm.value,
      releaseType: "standard",
      brand: "",
    };
    const requestBody = {
      medicine,
      strength,
      ...(requestProduct.strengthValue && requestProduct.strengthUnit && requestProduct.form ? { productRequest: requestProduct } : {}),
      pharmacies,
      confirmLive: isLive,
      consentAcknowledged: dom.consent.checked,
      liveCallAcknowledged: isLive,
    };
    const data = await apiCheck(accessToken, requestBody, updateCallProgress);
    if (simulateCheck) await wait(Math.max(0, 1_800 - (Date.now() - overlayStartedAt)));
    setLiveCallOverlay(false);
    showResults(data);
    checkCompleted = true;
  } catch (error) {
    setLiveCallOverlay(false);
    showError(/** @type {Error} */ (error).message);
  } finally {
    if (isLive || simulateCheck) setLiveCallOverlay(false);
    dom.run.disabled = false;
    updateCtaMode();
  }
  // Refresh history after releasing the call UI; a slow history read must
  // neither keep the animation open nor re-enable a later, separate call.
  if (checkCompleted) {
    try {
      history = await apiFetchHistory(accessToken);
      renderHistoryList(history);
    } catch (error) {
      showError(`The call results are available, but saved history could not refresh: ${/** @type {Error} */ (error).message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Event handlers — Navigation
// ---------------------------------------------------------------------------

dom.live.onchange = updateCtaMode;
document.querySelector("#dismiss-call-overlay").onclick = () => {
  setLiveCallOverlay(false);
  document.querySelector("#calling-status").textContent = "The check continues in the background. Results will appear when available.";
};

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.onclick = () => changeView(/** @type {string} */ (/** @type {HTMLElement} */ (button).dataset.view))
    .catch((error) => showError(`Could not change views: ${/** @type {Error} */ (error).message}`));
});

dom.home.onclick = () => changeView("workspace")
  .catch((error) => showError(`Could not return to the workspace: ${/** @type {Error} */ (error).message}`));

// ---------------------------------------------------------------------------
// Event handlers — History clicks
// ---------------------------------------------------------------------------

dom.historyList.onclick = (event) => {
const id = /** @type {HTMLElement} */ (event.target.closest("[data-history-id]"))?.dataset.historyId;
const record = history.find((item) => item.id === id);
  if (record) {
    try { showResults(record, true); }
    catch (error) { showError(`Could not show the saved result: ${/** @type {Error} */ (error).message}`); }
  }
};

dom.resetDemo.onclick = async () => {
  if (!await confirmMessage({ title: "Reset demo history?", message: "Demo checks will be removed. Your live-call records will stay saved.", confirmLabel: "Reset demo history" })) return;
  dom.resetDemo.disabled = true;
  try {
    const { deleted } = await apiResetDemoHistory(accessToken);
    history = await apiFetchHistory(accessToken);
    renderHistoryList(history);
    showMessage({ eyebrow: "DEMO HISTORY UPDATED", title: "Demo checks removed", message: `${deleted} demo check${deleted === 1 ? "" : "s"} removed. Live-call records are still saved.`, tone: "success" });
  } catch (error) {
    showError(/** @type {Error} */ (error).message);
  } finally {
    dom.resetDemo.disabled = false;
  }
};

dom.analyticsContent.onclick = async (event) => {
  const id = /** @type {HTMLElement} */ (event.target.closest("[data-history-id]"))?.dataset.historyId;
  if (!id) return;
  const record = history.find((item) => item.id === id);
  if (!record) return;
  try {
    showResults(record, true);
  } catch (error) { showError(`Could not show the saved result: ${/** @type {Error} */ (error).message}`); }
};

// ---------------------------------------------------------------------------
// Event handlers — Transcript downloads
// ---------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = /** @type {HTMLElement} */ (event.target.closest("[data-transcript-url]"));
  if (!button) return;
  button.disabled = true;
  try {
    await apiDownloadTranscript(accessToken, /** @type {string} */ (button.dataset.transcriptUrl));
  } catch (error) {
    showError(/** @type {Error} */ (error).message);
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Event handlers — Example value placeholders
// ---------------------------------------------------------------------------

document.querySelectorAll(".example-value").forEach((input) =>
  input.addEventListener(
    "focus",
    () => {
      if (input.classList.contains("example-value")) {
        input.value = "";
        input.classList.remove("example-value");
      }
    },
    { once: true }
  )
);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the workspace and load saved history for a previously entered token.
 * @returns {Promise<void>}
 */
async function initialize() {
  try { renderPharmacies(pharmacies); }
  catch (error) { showError(`Could not render the pharmacy list: ${/** @type {Error} */ (error).message}`); }

  applyRuntimeCapabilities(await apiFetchRuntimeCapabilities());

  try {
    history = await apiFetchHistory(accessToken);
    renderHistoryList(history);
    if (history.length) showResults(history[0], false, false);
  } catch (error) {
    showError(`Could not load saved history: ${/** @type {Error} */ (error).message}`);
  }
}

void initialize();
