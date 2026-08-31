"use strict";

const API_PATHS = Object.freeze({
  health: "/api/v1/health",
  scenarios: "/api/v1/scenarios",
  interviews: "/api/v1/interviews",
  createInterview: "/api/v1/interviews/fake",
});

const SAFE_ERROR_MESSAGES = Object.freeze({
  validation_error: "Check the fictional scenario and alias, then try again.",
  interview_not_found: "That record is no longer available. Refresh the list.",
  duplicate_interview: "The simulated record could not be assigned a unique ID.",
  repository_unavailable: "The local record store is unavailable.",
  repository_data_error: "A stored record could not be read safely.",
  internal_error: "The local request could not be completed.",
});

const ENUM_LABELS = Object.freeze({
  none: "None",
  minor: "Minor",
  moderate: "Moderate",
  critical: "Critical",
  unknown: "Unknown",
  draft: "Draft",
  planned: "Planned",
  awaiting_confirmation: "Awaiting confirmation",
  calling: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  fake: "Fake",
  "no-incident": "No incident",
  "minor-near-miss": "Minor near miss",
  "equipment-follow-up": "Equipment follow-up",
  "incomplete-answers": "Incomplete answers",
  action_required: "Action required",
  needs_clarification: "Needs clarification",
  no_immediate_action: "No immediate action",
  not_assessed: "Not assessed",
});

const BADGE_PRESENTATIONS = Object.freeze({
  status: Object.freeze({
    draft: { label: "Draft", className: "status-badge status-badge--unavailable" },
    planned: { label: "Planned", className: "status-badge status-badge--active" },
    awaiting_confirmation: { label: "Awaiting confirmation", className: "status-badge status-badge--attention" },
    calling: { label: "Processing", className: "status-badge status-badge--active" },
    completed: { label: "Completed", className: "status-badge status-badge--complete" },
    failed: { label: "Failed", className: "status-badge status-badge--critical" },
    cancelled: { label: "Cancelled", className: "status-badge status-badge--unavailable" },
    unknown: { label: "Unknown", className: "status-badge status-badge--unknown" },
    unavailable: { label: "Not available", className: "status-badge status-badge--unavailable" },
  }),
  incident: Object.freeze({
    none: { label: "None", className: "status-badge status-badge--clear" },
    minor: { label: "Minor", className: "status-badge status-badge--watch" },
    moderate: { label: "Moderate", className: "status-badge status-badge--attention" },
    critical: { label: "Critical", className: "status-badge status-badge--critical" },
    unknown: { label: "Unknown", className: "status-badge status-badge--unknown" },
    unavailable: { label: "Not available", className: "status-badge status-badge--unavailable" },
  }),
  followUp: Object.freeze({
    true: { label: "Required", className: "status-badge status-badge--attention" },
    false: { label: "Not required", className: "status-badge status-badge--clear" },
    unknown: { label: "Unknown", className: "status-badge status-badge--unknown" },
    unavailable: { label: "Not available", className: "status-badge status-badge--unavailable" },
  }),
  boolean: Object.freeze({
    true: { label: "Yes", className: "status-badge status-badge--attention" },
    false: { label: "No", className: "status-badge status-badge--clear" },
    unknown: { label: "Unknown", className: "status-badge status-badge--unknown" },
    unavailable: { label: "Not available", className: "status-badge status-badge--unavailable" },
  }),
  review: Object.freeze({
    action_required: { label: "Action required", className: "status-badge status-badge--critical" },
    needs_clarification: { label: "Needs clarification", className: "status-badge status-badge--attention" },
    no_immediate_action: { label: "No immediate action", className: "status-badge status-badge--clear" },
    not_assessed: { label: "Not assessed", className: "status-badge status-badge--unknown" },
    unknown: { label: "Unknown", className: "status-badge status-badge--unknown" },
    unavailable: { label: "Not available", className: "status-badge status-badge--unavailable" },
  }),
});

const elements = {
  appStatus: document.querySelector("#app-status"),
  interviewForm: document.querySelector("#interview-form"),
  scenario: document.querySelector("#scenario"),
  scenarioDescription: document.querySelector("#scenario-description"),
  recipientAlias: document.querySelector("#recipient-alias"),
  aliasError: document.querySelector("#alias-error"),
  runInterview: document.querySelector("#run-interview"),
  runStatus: document.querySelector("#run-status"),
  filterForm: document.querySelector("#filter-form"),
  incidentFilter: document.querySelector("#incident-filter"),
  reviewFilter: document.querySelector("#review-filter"),
  followUpFilter: document.querySelector("#follow-up-filter"),
  statusFilter: document.querySelector("#status-filter"),
  filterStatus: document.querySelector("#filter-status"),
  refreshRecords: document.querySelector("#refresh-records"),
  recordCount: document.querySelector("#record-count"),
  reviewCountAction: document.querySelector("#review-count-action"),
  reviewCountClarification: document.querySelector("#review-count-clarification"),
  reviewCountClear: document.querySelector("#review-count-clear"),
  reviewCountUnassessed: document.querySelector("#review-count-unassessed"),
  listRegion: document.querySelector("#interview-list-region"),
  interviewList: document.querySelector("#interview-list"),
  emptyList: document.querySelector("#empty-list"),
  emptyListTitle: document.querySelector("#empty-list-title"),
  emptyListGuidance: document.querySelector("#empty-list-guidance"),
  detailPanel: document.querySelector("#detail-panel"),
  detailStatus: document.querySelector("#detail-status"),
  detailContent: document.querySelector("#detail-content"),
  detailIdentity: document.querySelector("#detail-identity"),
  detailRecordId: document.querySelector("#detail-record-id"),
  detailSummaryIncident: document.querySelector("#detail-summary-incident"),
  detailSummaryFollowUp: document.querySelector("#detail-summary-follow-up"),
  detailSummaryEquipment: document.querySelector("#detail-summary-equipment"),
  detailSummaryStatus: document.querySelector("#detail-summary-status"),
  detailSummaryReview: document.querySelector("#detail-summary-review"),
  detailReviewBasis: document.querySelector("#detail-review-basis"),
  humanActionPanel: document.querySelector("#human-action-panel"),
  detailHumanActions: document.querySelector("#detail-human-actions"),
};

const detailFields = Object.freeze({
  work_summary: document.querySelector("#detail-work-summary"),
  near_miss_occurred: document.querySelector("#detail-near-miss"),
  equipment_issue_occurred: document.querySelector("#detail-equipment"),
  injury_or_health_issue: document.querySelector("#detail-injury"),
  handover_notes: document.querySelector("#detail-handover"),
  incident_level: document.querySelector("#detail-incident"),
  requires_follow_up: document.querySelector("#detail-follow-up"),
  confidence: document.querySelector("#detail-confidence"),
  summary: document.querySelector("#detail-summary"),
  provider: document.querySelector("#detail-provider"),
  provider_run_id: document.querySelector("#detail-run-id"),
  created_at: document.querySelector("#detail-created"),
  completed_at: document.querySelector("#detail-completed"),
  evidence_count: document.querySelector("#detail-evidence-count"),
});

const state = {
  scenarios: new Map(),
  isCreating: false,
  isLoadingList: false,
  isLoadingDetail: false,
};

function setBusy(element, busy) {
  element.setAttribute("aria-busy", busy ? "true" : "false");
}

function setGlobalStatus(message, isError = false) {
  elements.appStatus.textContent = message;
  elements.appStatus.setAttribute("data-state", isError ? "error" : "ready");
}

function formatTriState(value) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (value === null || value === undefined) {
    return "Not available";
  }
  if (String(value).toLowerCase() === "unknown") {
    return "Unknown";
  }
  return "Not available";
}

function formatEnum(value) {
  if (value === null || value === undefined) {
    return "Not available";
  }
  return ENUM_LABELS[String(value)] || "Unknown";
}

function getBadgePresentation(kind, value) {
  const presentations = BADGE_PRESENTATIONS[kind];
  let key;
  if (value === null || value === undefined) {
    key = "unavailable";
  } else if (value === true) {
    key = "true";
  } else if (value === false) {
    key = "false";
  } else {
    key = String(value).toLowerCase();
  }
  return presentations[key] || presentations.unknown;
}

function createStatusBadge(kind, value) {
  const presentation = getBadgePresentation(kind, value);
  const badge = document.createElement("span");
  badge.className = presentation.className;
  badge.textContent = presentation.label;
  return badge;
}

function setStatusBadge(element, kind, value) {
  const presentation = getBadgePresentation(kind, value);
  element.className = presentation.className;
  element.textContent = presentation.label;
}

function formatText(value) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }
  if (String(value).toLowerCase() === "unknown") {
    return "Unknown";
  }
  return String(value);
}

function formatConfidence(value) {
  if (value === null || value === undefined) {
    return "Not available";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unknown";
  }
  return `${Math.round(value * 100)}%`;
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  const jst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${padNumber(jst.getUTCMonth() + 1)}-${padNumber(jst.getUTCDate())} ${padNumber(jst.getUTCHours())}:${padNumber(jst.getUTCMinutes())} JST`;
}

async function readSafeError(response) {
  try {
    const payload = await response.json();
    const code = payload && payload.error && payload.error.code;
    return SAFE_ERROR_MESSAGES[code] || "The local request could not be completed.";
  } catch (_error) {
    return "The local request could not be completed.";
  }
}

async function fetchJson(path, options = undefined) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (_error) {
    throw new Error("The local API could not be reached.");
  }
  if (!response.ok) {
    const error = new Error(await readSafeError(response));
    error.statusCode = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch (_error) {
    throw new Error("The local API returned an unreadable response.");
  }
}

function validateRecipientAlias(value) {
  const hasControlCharacter = /[\u0000-\u001f\u007f]/.test(value);
  const looksLikeContactNumber = /(?:\+?\d[- ]?){8,15}/.test(value);
  const isFictionalAlias = /^(?:demo|fictional)-[A-Za-z0-9_-]+$/.test(value);
  if (value.length < 5 || value.length > 64 || hasControlCharacter) {
    return "Use a fictional alias between 5 and 64 characters.";
  }
  if (value.includes("@") || looksLikeContactNumber || !isFictionalAlias) {
    return "Use only a demo- or fictional- alias without personal contact details.";
  }
  return "";
}

async function loadHealth() {
  const health = await fetchJson(API_PATHS.health);
  if (health.provider !== "fake" || health.real_calls_enabled !== false) {
    throw new Error("The local safety boundary could not be confirmed.");
  }
}

function updateScenarioDescription() {
  const scenario = state.scenarios.get(elements.scenario.value);
  elements.scenarioDescription.textContent = scenario
    ? scenario.description
    : "Select a fictional scenario.";
}

async function loadScenarios() {
  const scenarios = await fetchJson(API_PATHS.scenarios);
  state.scenarios.clear();
  elements.scenario.replaceChildren();
  scenarios.forEach((scenario) => {
    state.scenarios.set(scenario.id, scenario);
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.display_name;
    elements.scenario.append(option);
  });
  elements.scenario.disabled = scenarios.length === 0;
  elements.runInterview.disabled = scenarios.length === 0;
  updateScenarioDescription();
}

function buildFilterQuery() {
  const query = new URLSearchParams();
  const filters = [
    ["incident_level", elements.incidentFilter.value],
    ["review_disposition", elements.reviewFilter.value],
    ["requires_follow_up", elements.followUpFilter.value],
    ["status", elements.statusFilter.value],
  ];
  filters.forEach(([name, value]) => {
    if (value) {
      query.set(name, value);
    }
  });
  return query.toString();
}

function createRecordField(label, value, modifierClass = "") {
  const field = document.createElement("div");
  field.className = "record-field";
  if (modifierClass) {
    field.classList.add(modifierClass);
  }
  const heading = document.createElement("b");
  const content = document.createElement("span");
  heading.textContent = label;
  content.textContent = value;
  field.append(heading, content);
  return field;
}

function createBadgeField(label, kind, value) {
  const field = document.createElement("div");
  field.className = "record-field record-field--decision";
  const heading = document.createElement("b");
  heading.textContent = label;
  field.append(heading, createStatusBadge(kind, value));
  return field;
}

function createInterviewCard(interview) {
  const item = document.createElement("li");
  item.className = "interview-card";
  item.append(
    createRecordField("Created at", formatDate(interview.created_at)),
    createRecordField("Scenario", formatEnum(interview.scenario_name), "record-field--scenario"),
    createBadgeField("Status", "status", interview.status),
    createBadgeField("Incident", "incident", interview.incident_level),
    createBadgeField("Follow-up", "followUp", interview.requires_follow_up),
    createBadgeField("Review", "review", interview.review_disposition),
    createRecordField("Provider", formatEnum(interview.provider)),
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className = "detail-action";
  button.textContent = "Details";
  button.setAttribute("aria-label", `View details for ${formatEnum(interview.scenario_name)} created at ${formatDate(interview.created_at)}`);
  button.addEventListener("click", () => loadInterviewDetail(interview.interview_id));
  item.append(button);
  return item;
}

function setEmptyState(hasFilters) {
  elements.emptyListTitle.textContent = hasFilters
    ? "No records match these filters."
    : "No interview records yet.";
  elements.emptyListGuidance.textContent = hasFilters
    ? "Change the filters or run another simulated interview."
    : "Run a Fake Provider simulated safety check to see how answers become structured follow-up records.";
}

function renderInterviewList(payload, hasFilters) {
  elements.interviewList.replaceChildren();
  payload.items.forEach((interview) => {
    elements.interviewList.append(createInterviewCard(interview));
  });
  setEmptyState(hasFilters);
  elements.emptyList.hidden = payload.items.length !== 0;
  elements.recordCount.textContent = `${payload.count} matching record${payload.count === 1 ? "" : "s"}`;
  const counts = payload.review_counts;
  elements.reviewCountAction.textContent = String(counts.action_required);
  elements.reviewCountClarification.textContent = String(counts.needs_clarification);
  elements.reviewCountClear.textContent = String(counts.no_immediate_action);
  elements.reviewCountUnassessed.textContent = String(counts.not_assessed);
}

function renderTextList(element, values) {
  element.replaceChildren();
  values.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    element.append(item);
  });
}

async function loadInterviews() {
  if (state.isLoadingList) {
    return;
  }
  state.isLoadingList = true;
  setBusy(elements.listRegion, true);
  setBusy(elements.filterForm, true);
  elements.refreshRecords.disabled = true;
  elements.filterStatus.textContent = "Applying filters…";
  const query = buildFilterQuery();
  try {
    const path = query ? `${API_PATHS.interviews}?${query}` : API_PATHS.interviews;
    const payload = await fetchJson(path);
    renderInterviewList(payload, query !== "");
    elements.filterStatus.textContent = query ? "Filters applied." : "No filters applied.";
  } catch (error) {
    elements.interviewList.replaceChildren();
    elements.emptyList.hidden = false;
    elements.emptyListTitle.textContent = "Records could not be loaded.";
    elements.emptyListGuidance.textContent = "Use Refresh to try again.";
    elements.recordCount.textContent = "Records unavailable";
    elements.filterStatus.textContent = error.message;
  } finally {
    state.isLoadingList = false;
    setBusy(elements.listRegion, false);
    setBusy(elements.filterForm, false);
    elements.refreshRecords.disabled = false;
  }
}

function renderInterviewDetail(interview) {
  elements.detailIdentity.textContent = `Recipient alias: ${formatText(interview.recipient_alias)}`;
  elements.detailRecordId.textContent = formatText(interview.interview_id);
  setStatusBadge(elements.detailSummaryIncident, "incident", interview.incident_level);
  setStatusBadge(elements.detailSummaryFollowUp, "followUp", interview.requires_follow_up);
  setStatusBadge(elements.detailSummaryEquipment, "boolean", interview.equipment_issue_occurred);
  setStatusBadge(elements.detailSummaryStatus, "status", interview.status);
  setStatusBadge(elements.detailSummaryReview, "review", interview.review_disposition);
  renderTextList(elements.detailReviewBasis, interview.review_basis);
  renderTextList(elements.detailHumanActions, interview.suggested_human_actions);
  elements.humanActionPanel.hidden = interview.suggested_human_actions.length === 0;
  detailFields.work_summary.textContent = formatText(interview.work_summary);
  detailFields.near_miss_occurred.textContent = formatTriState(interview.near_miss_occurred);
  detailFields.equipment_issue_occurred.textContent = formatTriState(interview.equipment_issue_occurred);
  detailFields.injury_or_health_issue.textContent = formatTriState(interview.injury_or_health_issue);
  detailFields.handover_notes.textContent = formatText(interview.handover_notes);
  detailFields.incident_level.textContent = formatEnum(interview.incident_level);
  detailFields.requires_follow_up.textContent = formatTriState(interview.requires_follow_up);
  detailFields.confidence.textContent = formatConfidence(interview.confidence);
  detailFields.summary.textContent = formatText(interview.summary);
  detailFields.provider.textContent = formatEnum(interview.provider);
  detailFields.provider_run_id.textContent = formatText(interview.provider_run_id);
  detailFields.created_at.textContent = formatDate(interview.created_at);
  detailFields.completed_at.textContent = formatDate(interview.completed_at);
  detailFields.evidence_count.textContent = Number.isInteger(interview.evidence_count)
    ? String(interview.evidence_count)
    : "Unknown";
  elements.detailContent.hidden = false;
  elements.detailStatus.textContent = "Detail loaded.";
}

function scrollDetailIntoView() {
  const bounds = elements.detailPanel.getBoundingClientRect();
  if (bounds.top >= 0 && bounds.top < window.innerHeight) {
    return;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  elements.detailPanel.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

async function loadInterviewDetail(interviewId) {
  if (state.isLoadingDetail) {
    return;
  }
  state.isLoadingDetail = true;
  setBusy(elements.detailPanel, true);
  elements.detailStatus.textContent = "Loading detail…";
  elements.detailContent.hidden = true;
  try {
    const safeIdentifier = encodeURIComponent(interviewId);
    const interview = await fetchJson(`${API_PATHS.interviews}/${safeIdentifier}`);
    renderInterviewDetail(interview);
    scrollDetailIntoView();
  } catch (error) {
    elements.detailIdentity.textContent = "No detail available.";
    elements.detailRecordId.textContent = "Not available";
    elements.detailStatus.textContent = error.statusCode === 404
      ? "That record was not found. Refresh the list."
      : error.message;
  } finally {
    state.isLoadingDetail = false;
    setBusy(elements.detailPanel, false);
  }
}

async function runSimulatedInterview(event) {
  event.preventDefault();
  if (state.isCreating) {
    return;
  }
  const recipientAlias = elements.recipientAlias.value;
  const aliasError = validateRecipientAlias(recipientAlias);
  elements.aliasError.textContent = aliasError;
  if (aliasError || !elements.scenario.value) {
    elements.runStatus.textContent = aliasError || "Select a fictional scenario.";
    return;
  }

  state.isCreating = true;
  setBusy(elements.interviewForm, true);
  elements.runInterview.disabled = true;
  elements.runStatus.textContent = "Running simulated interview…";
  try {
    const scenario = elements.scenario.value;
    const interview = await fetchJson(API_PATHS.createInterview, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario, recipient_alias: recipientAlias }),
    });
    elements.runStatus.textContent = "Simulated interview saved. Review the structured result in the record list.";
    await loadInterviews();
    renderInterviewDetail(interview);
  } catch (error) {
    elements.runStatus.textContent = error.message;
  } finally {
    state.isCreating = false;
    setBusy(elements.interviewForm, false);
    elements.runInterview.disabled = elements.scenario.disabled;
  }
}

async function initializeApplication() {
  setGlobalStatus("Loading local records…");
  try {
    await loadHealth();
    await loadScenarios();
    await loadInterviews();
    setGlobalStatus("Ready for a local simulated interview.");
  } catch (error) {
    setGlobalStatus(error.message, true);
    elements.runInterview.disabled = true;
  }
}

elements.interviewForm.addEventListener("submit", runSimulatedInterview);
elements.scenario.addEventListener("change", updateScenarioDescription);
elements.refreshRecords.addEventListener("click", loadInterviews);
elements.filterForm.addEventListener("change", loadInterviews);

initializeApplication();
