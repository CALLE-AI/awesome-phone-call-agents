import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Mock browser storage APIs
// ---------------------------------------------------------------------------

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
}

globalThis.localStorage = createMemoryStorage();
globalThis.sessionStorage = createMemoryStorage();

// Mock document (needed by dom.js which storage.js references via typedef)
globalThis.document = {
  querySelector: () => ({
    hidden: false, disabled: false, checked: false, value: "",
    textContent: "", innerHTML: "", classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, focus() {}, play() { return Promise.resolve(); }, pause() {},
    scrollIntoView() {}, querySelector() { return {}; }, addEventListener() {},
    onclick: null, onchange: null,
  }),
  querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} } },
};
globalThis.window = { scrollTo() {} };

const {
  loadSavedPharmacies,
  savePharmacies,
  loadAccessToken,
  saveAccessToken,
} = await import("../public/js/storage.js");

// ---------------------------------------------------------------------------
// loadSavedPharmacies
// ---------------------------------------------------------------------------

test("loadSavedPharmacies returns demo defaults when localStorage is empty", () => {
  localStorage.clear();
  const result = loadSavedPharmacies();
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "Harbor Health Pharmacy");
  assert.equal(result[0].phone, "+12025550123");
  assert.equal(result[1].name, "Riverside Care Pharmacy");
});

test("loadSavedPharmacies returns saved pharmacies from localStorage", () => {
  const saved = [
    { name: "Custom Pharmacy", phone: "+12025550999", distanceKm: "3.2" },
  ];
  localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify(saved));
  const result = loadSavedPharmacies();
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Custom Pharmacy");
  assert.equal(result[0].phone, "+12025550999");
  assert.equal(result[0].distanceKm, "3.2");
});

test("loadSavedPharmacies caps at 5 pharmacies", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    name: `Pharmacy ${i}`,
    phone: `+12025550${String(i).padStart(3, "0")}`,
    distanceKm: String(i),
  }));
  localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify(many));
  const result = loadSavedPharmacies();
  assert.equal(result.length, 5);
});

test("loadSavedPharmacies returns empty array for non-array JSON", () => {
  localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify("not-an-array"));
  const result = loadSavedPharmacies();
  assert.deepEqual(result, []);
});

test("loadSavedPharmacies returns empty array for malformed JSON", () => {
  localStorage.setItem("medroute-authorized-pharmacies", "not-json{{{");
  const result = loadSavedPharmacies();
  assert.deepEqual(result, []);
});

test("loadSavedPharmacies coerces non-string fields to strings", () => {
  const saved = [{ name: 123, phone: null, distanceKm: 42 }];
  localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify(saved));
  const result = loadSavedPharmacies();
  assert.equal(result[0].name, "123");
  assert.equal(result[0].phone, "");
  assert.equal(result[0].distanceKm, "42");
});

test("loadSavedPharmacies returns independent copies (no shared references)", () => {
  const saved = [{ name: "A", phone: "+12025550001", distanceKm: "1" }];
  localStorage.setItem("medroute-authorized-pharmacies", JSON.stringify(saved));
  const result = loadSavedPharmacies();
  result[0].name = "MUTATED";
  const result2 = loadSavedPharmacies();
  assert.equal(result2[0].name, "A");
});

// ---------------------------------------------------------------------------
// savePharmacies
// ---------------------------------------------------------------------------

test("savePharmacies persists pharmacies to localStorage", () => {
  const pharmacies = [
    { name: "Test Rx", phone: "+12025550456", distanceKm: "7.8" },
  ];
  savePharmacies(pharmacies);
  const raw = localStorage.getItem("medroute-authorized-pharmacies");
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Test Rx");
});

test("savePharmacies overwrites previous data", () => {
  savePharmacies([{ name: "First", phone: "+1", distanceKm: "1" }]);
  savePharmacies([{ name: "Second", phone: "+2", distanceKm: "2" }]);
  const result = loadSavedPharmacies();
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Second");
});

// ---------------------------------------------------------------------------
// loadAccessToken / saveAccessToken (sessionStorage)
// ---------------------------------------------------------------------------

test("loadAccessToken returns an empty string when sessionStorage is empty", () => {
  sessionStorage.clear();
  assert.equal(loadAccessToken(), "");
});

test("loadAccessToken returns saved token from sessionStorage", () => {
  sessionStorage.setItem("medroute-access-token", "my-secret-token");
  assert.equal(loadAccessToken(), "my-secret-token");
});

test("saveAccessToken persists token to sessionStorage", () => {
  saveAccessToken("live-api-key-123");
  assert.equal(sessionStorage.getItem("medroute-access-token"), "live-api-key-123");
});

test("saveAccessToken overwrites previous token", () => {
  saveAccessToken("token-a");
  saveAccessToken("token-b");
  assert.equal(loadAccessToken(), "token-b");
});

test("saveAccessToken handles empty string", () => {
  saveAccessToken("");
  assert.equal(sessionStorage.getItem("medroute-access-token"), "");
  assert.equal(loadAccessToken(), "");
});
