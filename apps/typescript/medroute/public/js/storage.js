// ============================================================================
// MedRoute — Storage Module
// Handles pharmacy list and access token persistence via localStorage/sessionStorage.
// ============================================================================

/**
 * @typedef {import("./dom.js").Pharmacy} Pharmacy
 */

/**
 * @typedef {Object} Pharmacy
 * @property {string} name - Pharmacy display name.
 * @property {string} phone - Phone number in E.164 format.
 * @property {string} distanceKm - Distance in kilometres (stored as string for input binding).
 */

/** @type {string} localStorage key for the authorized pharmacy list. */
const PHARMACY_STORAGE_KEY = "medroute-authorized-pharmacies";

/** @type {string} sessionStorage key for the operator access token. */
const TOKEN_STORAGE_KEY = "medroute-access-token";

/** @type {Pharmacy[]} Default demo pharmacies shown to first-time visitors. */
const defaultDemoPharmacies = [
  { name: "Harbor Health Pharmacy", phone: "+12025550123", distanceKm: "2.4" },
  { name: "Riverside Care Pharmacy", phone: "+12025550124", distanceKm: "5.1" },
];

/**
 * Load pharmacies from localStorage, falling back to demo defaults.
 * @returns {Pharmacy[]} Array of pharmacy objects (max 5).
 */
export function loadSavedPharmacies() {
  try {
    const stored = localStorage.getItem(PHARMACY_STORAGE_KEY);
    if (stored === null) return defaultDemoPharmacies.map((p) => ({ ...p }));
    const saved = JSON.parse(stored);
    return Array.isArray(saved)
      ? saved.slice(0, 5).map((p) => ({
          name: String(p.name || ""),
          phone: String(p.phone || ""),
          distanceKm: String(p.distanceKm ?? ""),
        }))
      : [];
  } catch {
    return [];
  }
}

/**
 * Persist the pharmacy list to localStorage.
 * @param {Pharmacy[]} pharmacies - Pharmacies to save.
 * @returns {void}
 */
export function savePharmacies(pharmacies) {
  localStorage.setItem(PHARMACY_STORAGE_KEY, JSON.stringify(pharmacies));
}

/**
 * Read the saved access token from sessionStorage.
 * @returns {string} The saved token, or an empty string if none is set.
 */
export function loadAccessToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

/**
 * Persist the access token to sessionStorage.
 * @param {string} token - Token value to save.
 * @returns {void}
 */
export function saveAccessToken(token) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}
