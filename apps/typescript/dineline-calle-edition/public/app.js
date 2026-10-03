const restaurants = [
  {
    id: "santoro-house",
    name: "Santoro House",
    monogram: "SH",
    address: "28 Bedford Street, New York, NY",
    phone: "+12025550143",
    cuisine: "Northern Italian",
    neighborhood: "West Village",
    rating: "4.7",
    reviews: "4.8k reviews",
    fit: "Quiet dining room",
  },
  {
    id: "laurel-finch",
    name: "Laurel & Finch",
    monogram: "LF",
    address: "142 Mercer Street, New York, NY",
    phone: "+12025550156",
    cuisine: "Modern Italian",
    neighborhood: "SoHo",
    rating: "4.6",
    reviews: "2.1k reviews",
    fit: "Warm, intimate room",
  },
  {
    id: "nami-social",
    name: "Nami Social",
    monogram: "NS",
    address: "61 West 19th Street, New York, NY",
    phone: "+12025550172",
    cuisine: "Italian coastal",
    neighborhood: "Flatiron",
    rating: "4.5",
    reviews: "1.7k reviews",
    fit: "Lively but conversational",
  },
  {
    id: "casa-verdi",
    name: "Casa Verdi",
    monogram: "CV",
    address: "90 Prince Street, New York, NY",
    phone: "+12025550188",
    cuisine: "Classic Italian",
    neighborhood: "Nolita",
    rating: "4.7",
    reviews: "3.3k reviews",
    fit: "Relaxed neighborhood feel",
  },
  {
    id: "osteria-grove",
    name: "Osteria Grove",
    monogram: "OG",
    address: "310 Bleecker Street, New York, NY",
    phone: "+12025550199",
    cuisine: "Seasonal Italian",
    neighborhood: "Greenwich Village",
    rating: "4.6",
    reviews: "2.6k reviews",
    fit: "Good for a quiet dinner",
  },
];

const stageOrder = ["draft", "approved", "dialing", "verifying", "returned"];
const outcomeCopy = {
  confirmed: {
    badge: "Verified",
    symbol: "\u2713",
    overline: "The restaurant confirmed your request",
    title: "Your table is booked.",
  },
  unavailable: {
    badge: "Not booked",
    symbol: "!",
    overline: "The restaurant does not have your requested time",
    title: "That time is not available.",
  },
  alternative_offered: {
    badge: "Your decision",
    symbol: "!",
    overline: "The restaurant suggested another time",
    title: "They offered another time.",
  },
  unreached: {
    badge: "Not reached",
    symbol: "!",
    overline: "Agent Jake reached voicemail",
    title: "No one answered.",
  },
  uncertain: {
    badge: "Needs a check",
    symbol: "?",
    overline: "The answer did not clearly match your request",
    title: "We need to double-check this.",
  },
};

const elements = {
  modeLabel: document.querySelector("#mode-label"),
  footerRuntimeCopy: document.querySelector("#footer-runtime-copy"),
  demoModeTitle: document.querySelector("#demo-mode-title"),
  demoModeDetail: document.querySelector("#demo-mode-detail"),
  intakeForm: document.querySelector("#intake-form"),
  dinerPhone: document.querySelector("#diner-phone"),
  intakeConsent: document.querySelector("#intake-consent"),
  intakeConsentCopy: document.querySelector("#intake-consent-copy"),
  intakeButton: document.querySelector("#intake-button"),
  intakeButtonKicker: document.querySelector("#intake-button-kicker"),
  intakeButtonLabel: document.querySelector("#intake-button-label"),
  sampleRequestButton: document.querySelector("#sample-request-button"),
  intakeResult: document.querySelector("#intake-result"),
  intakeResultTitle: document.querySelector("#intake-result-title"),
  intakeResultSummary: document.querySelector("#intake-result-summary"),
  intakeConfidence: document.querySelector("#intake-confidence"),
  intakePreferenceChips: document.querySelector("#intake-preference-chips"),
  intakeEvidence: document.querySelector("#intake-evidence"),
  intakeReconcileButton: document.querySelector("#intake-reconcile-button"),
  workspaceGrid: document.querySelector("#workspace-grid"),
  restaurantList: document.querySelector("#restaurant-list"),
  resultCount: document.querySelector("#result-count"),
  queryTitle: document.querySelector("#query-title"),
  queryDetail: document.querySelector("#query-detail"),
  selectedMonogram: document.querySelector("#selected-monogram"),
  selectedName: document.querySelector("#booking-title"),
  selectedAddress: document.querySelector("#selected-address"),
  bookingForm: document.querySelector("#booking-form"),
  date: document.querySelector("#reservation-date"),
  time: document.querySelector("#reservation-time"),
  partySize: document.querySelector("#party-size"),
  guestName: document.querySelector("#guest-name"),
  specialRequests: document.querySelector("#special-requests"),
  controlledDestinationField: document.querySelector("#controlled-destination-field"),
  controlledDestination: document.querySelector("#controlled-destination"),
  reviewButton: document.querySelector("#review-button"),
  scenario: document.querySelector("#scenario-select"),
  scenarioControl: document.querySelector("#scenario-control"),
  statusIndicator: document.querySelector("#status-indicator"),
  statusCopy: document.querySelector("#status-copy"),
  executionSteps: [...document.querySelectorAll("#execution-steps li")],
  closureSteps: [...document.querySelectorAll(".closure-rail li")],
  contractSection: document.querySelector("#contract-section"),
  contractRestaurant: document.querySelector("#contract-restaurant"),
  contractIdShort: document.querySelector("#contract-id-short"),
  contractGuest: document.querySelector("#contract-guest"),
  contractParty: document.querySelector("#contract-party"),
  contractDate: document.querySelector("#contract-date"),
  contractTime: document.querySelector("#contract-time"),
  contractPhone: document.querySelector("#contract-phone"),
  contractRequest: document.querySelector("#contract-request"),
  contractFingerprint: document.querySelector("#contract-fingerprint"),
  approvalCheckbox: document.querySelector("#approval-checkbox"),
  approvalModeCopy: document.querySelector("#approval-mode-copy"),
  executeButton: document.querySelector("#execute-button"),
  executeButtonKicker: document.querySelector("#execute-button-kicker"),
  executeButtonLabel: document.querySelector("#execute-button-label"),
  editButton: document.querySelector("#edit-button"),
  resultSection: document.querySelector("#result-section"),
  resultBadge: document.querySelector("#result-badge"),
  resultSymbol: document.querySelector("#result-symbol"),
  resultOverline: document.querySelector("#result-overline"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  resultConfidence: document.querySelector("#result-confidence"),
  resultConfirmation: document.querySelector("#result-confirmation"),
  resultProvider: document.querySelector("#result-provider"),
  reviewState: document.querySelector("#review-state"),
  evidenceList: document.querySelector("#evidence-list"),
  duplicateButton: document.querySelector("#duplicate-button"),
  bookingReconcileButton: document.querySelector("#booking-reconcile-button"),
  freshButton: document.querySelector("#fresh-button"),
  toast: document.querySelector("#toast"),
};

const state = {
  selectedRestaurant: restaurants[0],
  config: {
    mode: "fixture",
    realCallReady: false,
    bookingCallReady: false,
    intakeCallReady: false,
  },
  intakePreview: null,
  intakeComplete: false,
  isIntakeExecuting: false,
  pendingIntakeRequest: null,
  preview: null,
  approvedDraft: null,
  pendingBookingRequest: null,
  sessionId: createSessionId(),
  isExecuting: false,
  toastTimer: null,
};

initialize();

async function initialize() {
  elements.date.value = nextFriday();
  renderRestaurants();
  bindEvents();
  setStage("draft", "Ready for the planning call");

  try {
    state.config = await requestJson("/api/config");
    if (state.config.mode === "fixture") {
      elements.modeLabel.textContent = "Sample mode";
      elements.intakeConsentCopy.textContent = "Sample mode uses a simulated CALL-E result.";
      elements.intakeButtonKicker.textContent = "Safe sample";
      elements.intakeButtonLabel.textContent = "Run planning-call demo";
      elements.approvalModeCopy.textContent = "The simulated call can now run.";
      elements.demoModeTitle.textContent = "Sample mode";
      elements.demoModeDetail.textContent = "Nothing on this screen places a real call.";
      elements.executeButtonKicker.textContent = "Simulated on this screen";
      elements.executeButtonLabel.textContent = "Run Agent Jake demo call";
      elements.footerRuntimeCopy.textContent = "Local demo · No real calls · 2026";
    } else {
      elements.dinerPhone.value = "";
      elements.dinerPhone.placeholder = "+ and your country code";
      elements.controlledDestinationField.hidden = false;
      elements.controlledDestination.required = true;
      elements.scenarioControl.hidden = true;
      elements.sampleRequestButton.hidden = true;
      elements.demoModeTitle.textContent = "Controlled local test";
      elements.demoModeDetail.textContent = "Only server-approved test numbers can be called.";
      elements.executeButtonKicker.textContent = "One controlled call";
      elements.executeButtonLabel.textContent = "Have Agent Jake call the test line";
      elements.footerRuntimeCopy.textContent = "Controlled local calls · Allowlist enforced · 2026";

      if (state.config.bookingCallReady && state.config.intakeCallReady) {
        elements.modeLabel.textContent = "Both controlled calls armed";
      } else if (state.config.bookingCallReady || state.config.intakeCallReady) {
        elements.modeLabel.textContent = "One controlled call armed";
      } else {
        elements.modeLabel.textContent = "Real mode blocked";
      }

      elements.intakeConsentCopy.textContent = state.config.intakeCallReady
        ? "Checking this box permits one real planning call."
        : "The planning-call gate is still blocked on the server.";
      elements.intakeButtonKicker.textContent = state.config.intakeCallReady
        ? "One real call"
        : "Call blocked";
      elements.intakeButtonLabel.textContent = "Have DineLine call me";
      elements.approvalModeCopy.textContent = state.config.bookingCallReady
        ? "Your approval permits one call to the controlled test line."
        : "Agent Jake is blocked until his server gate and destination allowlist are ready.";
    }
    updateIntakeButton();
    updateExecutionButton();
  } catch (error) {
    elements.modeLabel.textContent = "Server unavailable";
    showToast(errorMessage(error), true);
  }
}

function bindEvents() {
  elements.intakeForm.addEventListener("submit", runPreferenceIntake);
  elements.intakeConsent.addEventListener("change", updateIntakeButton);
  elements.dinerPhone.addEventListener("input", resetIntakeResult);
  elements.sampleRequestButton.addEventListener("click", useSampleRequest);
  elements.intakeReconcileButton.addEventListener("click", reconcilePreferenceIntake);
  elements.bookingForm.addEventListener("submit", reviewContract);
  elements.bookingForm.addEventListener("input", invalidateApproval);
  elements.bookingForm.addEventListener("change", invalidateApproval);
  elements.approvalCheckbox.addEventListener("change", () => {
    updateExecutionButton();
  });
  elements.executeButton.addEventListener("click", () => executeApprovedContract(false));
  elements.duplicateButton.addEventListener("click", () => executeApprovedContract(true));
  elements.bookingReconcileButton.addEventListener("click", reconcileBookingCall);
  elements.freshButton.addEventListener("click", startFreshSession);
  elements.editButton.addEventListener("click", () => {
    invalidateApproval();
    elements.bookingForm.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.date.focus({ preventScroll: true });
  });
}

function updateIntakeButton() {
  const blockedRealCall =
    state.config.mode === "real" && !state.config.intakeCallReady;
  elements.intakeButton.disabled =
    !elements.intakeConsent.checked || state.isIntakeExecuting || blockedRealCall;
}

function updateExecutionButton() {
  const blockedRealCall =
    state.config.mode === "real" && !state.config.bookingCallReady;
  elements.approvalCheckbox.disabled = blockedRealCall;
  elements.executeButton.disabled =
    blockedRealCall ||
    !elements.approvalCheckbox.checked ||
    !state.preview ||
    state.isExecuting;
}

async function runPreferenceIntake(event) {
  event.preventDefault();
  if (!elements.intakeForm.reportValidity()) {
    return;
  }
  if (!elements.intakeConsent.checked) {
    showToast("Please confirm that DineLine may call this number once.", true);
    return;
  }

  state.isIntakeExecuting = true;
  updateIntakeButton();
  elements.intakeButton.setAttribute("aria-busy", "true");
  elements.intakeButtonKicker.textContent = "CALL-E Agent 1";
  elements.intakeButtonLabel.textContent =
    state.config.mode === "fixture" ? "Running the sample call..." : "Calling you now...";
  setStatus("DineLine Concierge is gathering your dinner request", "busy");

  try {
    const request = {
      phone: elements.dinerPhone.value.trim(),
      sessionId: state.sessionId,
      explicitConsent: true,
    };
    const previewResponse = await requestJson("/api/intake/preview", {
      method: "POST",
      body: JSON.stringify(request),
    });
    state.intakePreview = previewResponse.preview;

    const startedAt = Date.now();
    const executionRequest = {
      request,
      approvedRequestId: previewResponse.preview.requestId,
      scenario: "complete",
    };
    const response = await requestJson("/api/intake/execute", {
      method: "POST",
      body: JSON.stringify(executionRequest),
    });
    await sleep(Math.max(0, 780 - (Date.now() - startedAt)));

    if (response.execution.kind === "duplicate_blocked") {
      showToast("That planning call already ran. Start over before trying again.", true);
      return;
    }

    const outcome = response.execution.outcome;
    const isPending =
      response.execution.kind === "dispatch_unknown" &&
      Boolean(outcome.providerCallId);
    state.pendingIntakeRequest = isPending
      ? {
          request,
          approvedRequestId: previewResponse.preview.requestId,
        }
      : null;
    elements.intakeReconcileButton.hidden = !isPending;
    elements.dinerPhone.disabled = isPending;
    renderIntakeOutcome(outcome, { pending: isPending });
    if (isPending) {
      setStatus("CALL-E accepted the call and is finishing the result", "review");
      showToast("The call was accepted. Do not call again; check this call's status.");
      return;
    }
    if (outcome.usableForSearch && outcome.preferences) {
      revealRestaurantChoices(outcome.preferences);
    } else {
      setStatus("DineLine needs one more detail before searching", "review");
      showToast("The call did not collect every required detail. No restaurant search was started.", true);
    }
  } catch (error) {
    setStatus("The planning call did not finish", "review");
    showToast(errorMessage(error), true);
  } finally {
    state.isIntakeExecuting = false;
    elements.intakeButton.removeAttribute("aria-busy");
    elements.intakeButtonKicker.textContent = state.intakeComplete
      ? "Call completed"
      : state.config.mode === "fixture"
        ? "Safe sample"
        : "One real call";
    elements.intakeButtonLabel.textContent = state.intakeComplete
      ? "Dinner request captured"
      : state.config.mode === "fixture"
        ? "Run planning-call demo"
        : "Have DineLine call me";
    updateIntakeButton();
  }
}

function useSampleRequest() {
  const preferences = samplePreferences();
  renderIntakeOutcome({
    preferences,
    usableForSearch: true,
    missingFields: [],
    confidence: 1,
    summary: "Sample dinner request loaded without placing a call.",
    evidence: ["You chose the built-in fictional dinner request."],
    needsUserInput: false,
  });
  revealRestaurantChoices(preferences);
}

function renderIntakeOutcome(outcome, options = {}) {
  const pending = options.pending === true;
  const needsInput = outcome.needsUserInput || !outcome.preferences;
  elements.intakeResult.hidden = false;
  elements.intakeResult.classList.toggle("is-review", needsInput);
  elements.intakeResultTitle.textContent = pending
    ? "The call is still processing"
    : needsInput
    ? "A few details still need you"
    : "Dinner request ready";
  elements.intakeResultSummary.textContent = outcome.summary;
  elements.intakeConfidence.textContent = pending
    ? "Pending"
    : `${Math.round(outcome.confidence * 100)}%`;

  elements.intakePreferenceChips.replaceChildren();
  const preferences = outcome.preferences;
  if (preferences) {
    const chips = [
      preferences.cuisine,
      preferences.location,
      preferences.partySize ? `${preferences.partySize} people` : null,
      preferences.date ? formatDate(preferences.date) : null,
      preferences.time ? formatTime(preferences.time) : null,
      preferences.atmosphere,
    ].filter(Boolean);
    for (const value of chips) {
      const chip = document.createElement("span");
      chip.textContent = value;
      elements.intakePreferenceChips.append(chip);
    }
  }

  elements.intakeEvidence.replaceChildren();
  const evidence = outcome.evidence.length
    ? outcome.evidence
    : ["No reliable call evidence returned. Use the fields on screen instead."];
  for (const item of evidence) {
    const row = document.createElement("li");
    row.textContent = item;
    elements.intakeEvidence.append(row);
  }
}

async function reconcilePreferenceIntake() {
  if (!state.pendingIntakeRequest || state.isIntakeExecuting) {
    return;
  }

  state.isIntakeExecuting = true;
  elements.intakeReconcileButton.disabled = true;
  elements.intakeReconcileButton.textContent = "Checking CALL-E...";
  setStatus("Checking the accepted planning call", "busy");

  try {
    const response = await requestJson("/api/intake/reconcile", {
      method: "POST",
      body: JSON.stringify(state.pendingIntakeRequest),
    });

    if (response.execution.kind === "duplicate_blocked") {
      showToast("That call has already been processed.");
      return;
    }

    const outcome = response.execution.outcome;
    const isPending = response.execution.kind === "dispatch_unknown";
    renderIntakeOutcome(outcome, { pending: isPending });
    if (isPending) {
      setStatus("CALL-E is still finishing the accepted call", "review");
      showToast("Still processing. No second call was placed.");
      return;
    }

    state.pendingIntakeRequest = null;
    elements.intakeReconcileButton.hidden = true;
    elements.dinerPhone.disabled = false;
    if (outcome.usableForSearch && outcome.preferences) {
      revealRestaurantChoices(outcome.preferences);
    } else {
      setStatus("DineLine needs one more detail before searching", "review");
    }
  } catch (error) {
    setStatus("The accepted call could not be checked", "review");
    showToast(errorMessage(error), true);
  } finally {
    state.isIntakeExecuting = false;
    elements.intakeReconcileButton.disabled = false;
    elements.intakeReconcileButton.textContent = "Check this accepted call";
    updateIntakeButton();
  }
}

function revealRestaurantChoices(preferences) {
  applyPreferences(preferences);
  state.intakeComplete = true;
  elements.workspaceGrid.hidden = false;
  elements.intakeConsent.checked = false;
  setStage("draft", "Five restaurant choices are ready");
  updateIntakeButton();
  elements.workspaceGrid.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyPreferences(preferences) {
  const { location, cuisine, date, time, partySize } = preferences;
  if (!location || !cuisine || !date || !time || !partySize) {
    throw new Error("Restaurant choices require a complete dinner request.");
  }
  const atmosphere = preferences.atmosphere ?? "";

  elements.queryTitle.textContent = `${cuisine} dinner in ${location}`;
  elements.queryDetail.textContent = [
    atmosphere,
    formatDate(date),
    `${partySize} ${pluralizeGuest(partySize)}`,
  ].join(" · ");
  elements.date.value = date;
  elements.time.value = time;
  elements.partySize.value = String(partySize);
  elements.specialRequests.value = atmosphere;
  state.preview = null;
  state.approvedDraft = null;
}

function resetIntakeResult() {
  if (!state.intakeComplete && elements.intakeResult.hidden) {
    updateIntakeButton();
    return;
  }

  state.intakePreview = null;
  state.intakeComplete = false;
  state.pendingIntakeRequest = null;
  elements.intakeReconcileButton.hidden = true;
  elements.dinerPhone.disabled = false;
  elements.intakeResult.hidden = true;
  elements.workspaceGrid.hidden = true;
  invalidateApproval();
  setStage("draft", "Ready for the planning call");
  updateIntakeButton();
}

function samplePreferences() {
  return {
    location: "Manhattan, New York",
    cuisine: "Italian",
    date: nextFriday(),
    time: "19:30",
    timeZone: "America/New_York",
    partySize: 2,
    budget: "upscale",
    atmosphere: "Quiet enough to talk, warm, and not stuffy",
    dietaryNeeds: [],
    notes: "A relaxed Friday dinner.",
  };
}

function renderRestaurants() {
  elements.restaurantList.replaceChildren();

  for (const restaurant of restaurants) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "restaurant-card";
    card.dataset.restaurantId = restaurant.id;
    card.setAttribute("aria-pressed", String(restaurant.id === state.selectedRestaurant.id));
    if (restaurant.id === state.selectedRestaurant.id) {
      card.classList.add("is-selected");
    }

    const top = document.createElement("div");
    top.className = "restaurant-card-top";

    const monogram = document.createElement("span");
    monogram.className = "restaurant-monogram";
    monogram.textContent = restaurant.monogram;

    const copy = document.createElement("div");
    const name = document.createElement("h4");
    name.textContent = restaurant.name;
    const description = document.createElement("p");
    description.textContent = `${restaurant.cuisine} - ${restaurant.neighborhood}`;
    copy.append(name, description);
    top.append(monogram, copy);

    const meta = document.createElement("div");
    meta.className = "restaurant-meta";
    const rating = document.createElement("strong");
    rating.textContent = `${restaurant.rating} / 5`;
    const reviews = document.createElement("span");
    reviews.textContent = restaurant.reviews;
    const fit = document.createElement("span");
    fit.textContent = restaurant.fit;
    meta.append(rating, reviews, fit);

    card.append(top, meta);
    card.addEventListener("click", () => selectRestaurant(restaurant));
    elements.restaurantList.append(card);
  }
}

function selectRestaurant(restaurant) {
  if (restaurant.id === state.selectedRestaurant.id) {
    return;
  }

  state.selectedRestaurant = restaurant;
  elements.selectedMonogram.textContent = restaurant.monogram;
  elements.selectedName.textContent = restaurant.name;
  elements.selectedAddress.textContent = restaurant.address;
  renderRestaurants();
  invalidateApproval();
}

async function reviewContract(event) {
  event.preventDefault();
  if (!elements.bookingForm.reportValidity()) {
    return;
  }

  elements.reviewButton.disabled = true;
  elements.reviewButton.setAttribute("aria-busy", "true");
  setStatus("Preparing the reservation details", "busy");

  try {
    const draft = readDraft();
    const response = await requestJson("/api/preview", {
      method: "POST",
      body: JSON.stringify(draft),
    });

    state.preview = response.preview;
    state.approvedDraft = structuredClone(draft);
    renderContract(response.preview);
    elements.contractSection.hidden = false;
    elements.resultSection.hidden = true;
    elements.approvalCheckbox.checked = false;
    updateExecutionButton();
    setStage("approved", "Waiting for your approval");
    elements.contractSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStage("draft", "Could not check the details", "review");
    showToast(errorMessage(error), true);
  } finally {
    elements.reviewButton.disabled = false;
    elements.reviewButton.removeAttribute("aria-busy");
  }
}

function renderContract(preview) {
  elements.contractRestaurant.textContent = preview.restaurant.name;
  elements.contractIdShort.textContent = `ID ${preview.contractId.slice(0, 10)}`;
  elements.contractGuest.textContent = preview.reservation.guestName;
  elements.contractParty.textContent = `${preview.reservation.partySize} ${pluralizeGuest(preview.reservation.partySize)}`;
  elements.contractDate.textContent = formatDate(preview.reservation.date);
  elements.contractTime.textContent = `${formatTime(preview.reservation.time)} ET`;
  elements.contractPhone.textContent = preview.restaurant.phone;
  elements.contractRequest.textContent = preview.reservation.specialRequests || "None";
  elements.contractFingerprint.textContent = `${preview.contractId.slice(0, 24)}...`;
}

function invalidateApproval() {
  if (!state.preview && elements.contractSection.hidden) {
    return;
  }

  state.preview = null;
  state.approvedDraft = null;
  state.pendingBookingRequest = null;
  elements.approvalCheckbox.checked = false;
  updateExecutionButton();
  elements.contractSection.hidden = true;
  elements.resultSection.hidden = true;
  elements.bookingReconcileButton.hidden = true;
  elements.duplicateButton.hidden = false;
  setStage("draft", "Details changed - please check again");
}

async function executeApprovedContract(isDuplicateTest) {
  if (state.isExecuting || !state.preview || !state.approvedDraft) {
    return;
  }

  if (!elements.approvalCheckbox.checked) {
    showToast("Please confirm that the reservation details are right.", true);
    return;
  }

  if (state.config.mode === "real" && !state.config.bookingCallReady) {
    showToast("Agent Jake is still blocked by the server safety gate.", true);
    return;
  }

  state.isExecuting = true;
  elements.executeButton.disabled = true;
  elements.duplicateButton.disabled = true;
  elements.executeButton.setAttribute("aria-busy", "true");

  try {
    if (!isDuplicateTest) {
      setStage(
        "dialing",
        state.config.mode === "fixture" ? "Running the simulated call" : "Agent Jake is calling",
        "busy",
      );
      await sleep(540);
      setStage("verifying", "Checking the restaurant's answer", "busy");
    } else {
      setStatus("Making sure a second call cannot happen", "busy");
    }

    const startedAt = Date.now();
    const executionRequest = {
      draft: state.approvedDraft,
      approvedContractId: state.preview.contractId,
      explicitApproval: true,
      scenario: state.config.mode === "fixture" ? elements.scenario.value : "confirmed",
      sessionId: state.sessionId,
    };
    const response = await requestJson("/api/execute", {
      method: "POST",
      body: JSON.stringify(executionRequest),
    });

    if (!isDuplicateTest) {
      await sleep(Math.max(0, 620 - (Date.now() - startedAt)));
    }

    if (response.execution.kind === "duplicate_blocked") {
      renderDuplicateBlocked(response);
      return;
    }

    const isPending =
      response.execution.kind === "dispatch_unknown" &&
      Boolean(response.execution.outcome.providerCallId);
    state.pendingBookingRequest = isPending
      ? {
          draft: executionRequest.draft,
          approvedContractId: executionRequest.approvedContractId,
          explicitApproval: true,
          sessionId: executionRequest.sessionId,
        }
      : null;
    elements.bookingReconcileButton.hidden = !isPending;
    elements.duplicateButton.hidden = isPending;
    renderOutcome(response, { pending: isPending });
    setStage(
      "returned",
      isPending
        ? "CALL-E accepted the call and is finishing the result"
        : response.execution.outcome.needsHumanReview
        ? "The answer needs a closer look"
        : "Your reservation update is ready",
      isPending || response.execution.outcome.needsHumanReview ? "review" : "ready",
    );
    elements.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 409) {
      invalidateApproval();
      showToast("The reservation changed. Please check and approve it again.", true);
    } else {
      setStage("returned", "The call did not finish", "review");
      showToast(errorMessage(error), true);
    }
  } finally {
    state.isExecuting = false;
    elements.executeButton.removeAttribute("aria-busy");
    updateExecutionButton();
    elements.duplicateButton.disabled = false;
  }
}

function renderOutcome(response, options = {}) {
  const outcome = response.execution.outcome;
  const pending = options.pending === true;
  const copy = outcomeCopy[outcome.outcome] ?? outcomeCopy.uncertain;
  const needsReview = pending || outcome.needsHumanReview;

  elements.resultSection.hidden = false;
  elements.resultSection.classList.toggle("is-review", needsReview);
  elements.resultBadge.textContent = pending ? "Still checking" : copy.badge;
  elements.resultSymbol.textContent = pending ? "..." : copy.symbol;
  elements.resultOverline.textContent = pending
    ? "CALL-E accepted the controlled call"
    : copy.overline;
  elements.resultTitle.textContent = pending
    ? "The final result is still processing."
    : copy.title;
  elements.resultSummary.textContent = pending
    ? outcome.summary
    : humanOutcomeSummary(response);
  elements.resultConfidence.textContent = pending
    ? "Pending"
    : `${Math.round(outcome.confidence * 100)}%`;
  elements.resultConfirmation.textContent = pending
    ? "Not available yet"
    : confirmationValue(outcome);
  elements.resultProvider.textContent = outcome.providerCallId ?? `${response.provider} / none`;
  elements.reviewState.textContent = pending
    ? "Do not call again"
    : needsReview
      ? "Needs a person to review"
      : "No review needed";

  elements.evidenceList.replaceChildren();
  const evidence = outcome.evidence.length
    ? outcome.evidence
    : ["No clear answer came back, so DineLine did not mark the reservation as booked."];
  for (const item of evidence) {
    const row = document.createElement("li");
    row.textContent = item;
    elements.evidenceList.append(row);
  }
}

async function reconcileBookingCall() {
  if (!state.pendingBookingRequest || state.isExecuting) {
    return;
  }

  state.isExecuting = true;
  elements.bookingReconcileButton.disabled = true;
  elements.bookingReconcileButton.textContent = "Checking CALL-E...";
  setStatus("Checking the accepted Agent Jake call", "busy");

  try {
    const response = await requestJson("/api/reconcile", {
      method: "POST",
      body: JSON.stringify(state.pendingBookingRequest),
    });

    if (response.execution.kind === "duplicate_blocked") {
      showToast("That call has already been processed.");
      return;
    }

    const isPending = response.execution.kind === "dispatch_unknown";
    renderOutcome(response, { pending: isPending });
    if (isPending) {
      setStage("returned", "CALL-E is still finishing the accepted call", "review");
      showToast("Still processing. No second call was placed.");
      return;
    }

    state.pendingBookingRequest = null;
    elements.bookingReconcileButton.hidden = true;
    elements.duplicateButton.hidden = false;
    setStage(
      "returned",
      response.execution.outcome.needsHumanReview
        ? "The answer needs a closer look"
        : "Your reservation update is ready",
      response.execution.outcome.needsHumanReview ? "review" : "ready",
    );
  } catch (error) {
    setStage("returned", "The accepted call could not be checked", "review");
    showToast(errorMessage(error), true);
  } finally {
    state.isExecuting = false;
    elements.bookingReconcileButton.disabled = false;
    elements.bookingReconcileButton.textContent = "Check this accepted call";
    updateExecutionButton();
  }
}

function renderDuplicateBlocked(response) {
  elements.resultSection.hidden = false;
  elements.resultSection.classList.remove("is-review");
  elements.resultBadge.textContent = "Blocked";
  elements.resultSymbol.textContent = "\u2713";
  elements.resultOverline.textContent = "This reservation was already attempted";
  elements.resultTitle.textContent = "A second call was not made.";
  elements.resultSummary.textContent =
    "DineLine saw the same approved reservation and stopped it before Agent Jake could call again.";
  elements.resultConfidence.textContent = "100%";
  elements.resultConfirmation.textContent = "No second call";
  elements.resultProvider.textContent = response.provider;
  elements.reviewState.textContent = "No review needed";
  elements.evidenceList.replaceChildren();
  const row = document.createElement("li");
  row.textContent = "The reservation matched the request that already ran, so it was stopped before another call.";
  elements.evidenceList.append(row);
  setStage("returned", "The second call was blocked");
  showToast("No second call was made.");
  elements.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startFreshSession() {
  state.sessionId = createSessionId();
  state.intakePreview = null;
  state.intakeComplete = false;
  state.isIntakeExecuting = false;
  state.pendingIntakeRequest = null;
  state.preview = null;
  state.approvedDraft = null;
  state.pendingBookingRequest = null;
  state.isExecuting = false;
  elements.approvalCheckbox.checked = false;
  elements.controlledDestination.value = "";
  elements.dinerPhone.disabled = false;
  updateExecutionButton();
  elements.contractSection.hidden = true;
  elements.resultSection.hidden = true;
  elements.intakeResult.hidden = true;
  elements.intakeResult.classList.remove("is-review");
  elements.intakeReconcileButton.hidden = true;
  elements.workspaceGrid.hidden = true;
  elements.intakeConsent.checked = false;
  elements.resultSection.classList.remove("is-review");
  elements.bookingReconcileButton.hidden = true;
  elements.duplicateButton.hidden = false;
  setStage("draft", "Ready for the planning call");
  updateIntakeButton();
  showToast("Ready to start again.");
  elements.intakeForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function readDraft() {
  const destination =
    state.config.mode === "real"
      ? elements.controlledDestination.value.trim()
      : state.selectedRestaurant.phone;

  return {
    restaurant: {
      name: state.selectedRestaurant.name,
      address: state.selectedRestaurant.address,
      phone: destination,
    },
    reservation: {
      date: elements.date.value,
      time: elements.time.value,
      timeZone: "America/New_York",
      partySize: Number(elements.partySize.value),
      guestName: elements.guestName.value,
      specialRequests: elements.specialRequests.value,
    },
    policy: {
      acceptAlternativeTime: false,
      leaveVoicemail: false,
      discloseAiCaller: true,
    },
  };
}

function setStage(stage, status, tone = "ready") {
  const currentIndex = stageOrder.indexOf(stage);
  elements.executionSteps.forEach((step, index) => {
    step.classList.toggle("is-complete", index < currentIndex);
    step.classList.toggle("is-current", index === currentIndex);
  });

  const closureIndex = {
    draft: state.intakeComplete ? 1 : 0,
    approved: 2,
    dialing: 3,
    verifying: 4,
    returned: 5,
  }[stage];
  elements.closureSteps.forEach((step, index) => {
    step.classList.toggle("is-active", index <= closureIndex);
  });
  setStatus(status, tone);
}

function setStatus(copy, tone = "ready") {
  elements.statusCopy.textContent = copy;
  elements.statusIndicator.classList.toggle("is-busy", tone === "busy");
  elements.statusIndicator.classList.toggle("is-review", tone === "review");
}

function confirmationValue(outcome) {
  if (outcome.confirmationCode) {
    return outcome.confirmationCode;
  }
  if (outcome.alternativeDate && outcome.alternativeTime) {
    return `${formatDate(outcome.alternativeDate)}, ${formatTime(outcome.alternativeTime)}`;
  }
  return "None issued";
}

function humanOutcomeSummary(response) {
  const outcome = response.execution.outcome;
  const reservation = state.approvedDraft?.reservation;
  const restaurantName = state.approvedDraft?.restaurant.name ?? "the restaurant";

  if (outcome.outcome === "confirmed" && reservation) {
    return `Agent Jake confirmed a table for ${reservation.partySize} at ${restaurantName} on ${formatDate(reservation.date)} at ${formatTime(reservation.time)}.`;
  }
  if (outcome.outcome === "unavailable") {
    return "The restaurant said your requested time is not available. Nothing was booked.";
  }
  if (outcome.outcome === "alternative_offered") {
    const alternative =
      outcome.alternativeDate && outcome.alternativeTime
        ? `${formatDate(outcome.alternativeDate)} at ${formatTime(outcome.alternativeTime)}`
        : "another time";
    return `The restaurant offered ${alternative} instead. Nothing was booked without your approval.`;
  }
  if (outcome.outcome === "unreached") {
    return "Agent Jake reached voicemail and did not leave a message.";
  }
  if (response.scenario === "timeout") {
    return "The call service did not return a clear answer, so DineLine did not mark anything as booked.";
  }
  return "The answer conflicted with what the restaurant said, so DineLine stopped and asked for a person to review it.";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new HttpRequestError(response.status, body.error ?? "Request failed");
  }
  return body;
}

class HttpRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 4200);
}

function createSessionId() {
  if (window.crypto?.randomUUID) {
    return `session-${window.crypto.randomUUID()}`;
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextFriday() {
  const date = new Date();
  const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
}

function pluralizeGuest(count) {
  return count === 1 ? "guest" : "guests";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "The request failed safely.";
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
