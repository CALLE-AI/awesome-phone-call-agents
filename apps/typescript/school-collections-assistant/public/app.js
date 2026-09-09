const form = document.getElementById("reminderForm");
const button = document.getElementById("callButton");
const status = document.getElementById("callStatus");
const result = document.getElementById("result");
const apiTokenInput = document.getElementById("apiToken");
const confirmLiveInput = document.getElementById("confirmLiveCall");

const TOKEN_STORAGE_KEY = "schoolCollectionsApiToken";

if (apiTokenInput) {
  apiTokenInput.value = sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
  apiTokenInput.addEventListener("change", () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, apiTokenInput.value.trim());
  });
}

function clearResult() {
  while (result.firstChild) result.removeChild(result.firstChild);
}

function appendText(parent, tag, text, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function showEmpty(messageLines) {
  clearResult();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.appendChild(document.createElement("div"));
  for (const line of messageLines) {
    appendText(empty, "p", line);
  }
  result.appendChild(empty);
}

function showError(message) {
  clearResult();
  const box = document.createElement("div");
  box.className = "error";
  appendText(box, "strong", "Something went wrong");
  appendText(box, "p", String(message || "Unknown error"));
  result.appendChild(box);
}

function showResult(call) {
  clearResult();
  const box = document.createElement("div");
  box.className = "result";

  const r = call.structuredResult && typeof call.structuredResult === "object"
    ? call.structuredResult
    : {};

  const rows = [
    ["Mode", call.mode || "unknown"],
    ["Real call placed", call.realCallPlaced ? "Yes" : "No"],
    ["Phone (masked)", call.phoneMasked || "Not available"],
    ["Intent key", call.intentKey || "Not available"],
    ["Payment awareness", r.payment_awareness || "Unknown"],
    ["Will pay?", r.will_pay || "Unknown"],
    ["Expected payment date", r.payment_date || "Not provided"],
    ["AI confidence", formatConfidence(call.completionConfidence)],
    ["Call status", call.status || "Unknown"],
    ["Task completed", call.taskCompleted ? "Yes" : "No"],
  ];

  if (typeof r.parent_response === "string" && r.parent_response.trim()) {
    rows.push(["Parent response", r.parent_response]);
  }

  for (const [label, value] of rows) {
    const item = document.createElement("div");
    item.className = "result-item";
    appendText(item, "small", label);
    appendText(item, "strong", String(value));
    box.appendChild(item);
  }

  result.appendChild(box);
}

function formatConfidence(value) {
  if (value == null) return "N/A";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "N/A";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const apiToken = (apiTokenInput?.value || "").trim();
  if (!apiToken) {
    status.textContent = "API token required";
    showError("Enter the SCHOOL_COLLECTIONS_API_TOKEN value configured on the server.");
    return;
  }

  sessionStorage.setItem(TOKEN_STORAGE_KEY, apiToken);

  button.disabled = true;
  button.textContent = "Calling...";
  status.textContent = "Submitting reminder request...";
  showEmpty([
    "The assistant is handling the request.",
    "Please wait...",
  ]);

  const data = {
    parentName: document.getElementById("parentName").value,
    studentName: document.getElementById("studentName").value,
    phoneNumber: document.getElementById("phoneNumber").value,
    amount: document.getElementById("amount").value,
    dueDate: document.getElementById("dueDate").value,
    schoolName: document.getElementById("schoolName").value,
    intentId: document.getElementById("intentId")?.value || "",
    confirmLiveCall: Boolean(confirmLiveInput?.checked),
  };

  try {
    const response = await fetch("/api/reminder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(data),
    });

    const call = await response.json();

    if (!response.ok) {
      throw new Error(call.error || `Request failed (${response.status})`);
    }

    status.textContent =
      call.mode === "fake"
        ? "Fake dry-run completed (no call placed)"
        : "Call completed";
    showResult(call);
  } catch (error) {
    status.textContent = "Request failed";
    // Provider/API strings are untrusted — render as text only.
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Start Reminder Call";
  }
});
