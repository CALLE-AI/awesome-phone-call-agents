import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "n8n");

async function writeWorkflow(fileName, workflowDefinition) {
  await writeFile(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(workflowDefinition, null, 2)}\n`,
    "utf8",
  );
}

function buildIntegrationWorkflow() {
  const nodes = [
    webhookNode("Start CALL-E Dinner Plan", "dineline-calle-plan", [-1248, -320]),
    codeNode("Validate Planning Request", validatePlanningRequestCode, [-992, -320]),
    httpNode(
      "Preview CALL-E Intake Request",
      "http://127.0.0.1:4173/api/intake/preview",
      "={{ $json.request }}",
      [-736, -320],
      { timeout: 10_000 },
    ),
    codeNode("Bind CALL-E Intake Approval", bindIntakeApprovalCode, [-480, -320]),
    httpNode(
      "Dispatch CALL-E Preference Agent",
      "http://127.0.0.1:4173/api/n8n/intake/dispatch",
      "={{ $json }}",
      [-224, -320],
      { timeout: 330_000, retryOnFail: false },
    ),
    switchBooleanNode(
      "Switch Preferences Ready",
      "={{ $json.planningResult.usableForSearch }}",
      "ready",
      [32, -320],
    ),
    httpNode(
      "Google Places Text Search",
      "https://places.googleapis.com/v1/places:searchText",
      "={{ { textQuery: (($json.planningResult.preferences.cuisine || 'restaurant') + ' restaurants in ' + $json.planningResult.preferences.location), includedType: 'restaurant', strictTypeFiltering: false, maxResultCount: 10, languageCode: 'en', regionCode: 'US' } }}",
      [288, -416],
      {
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Content-Type", value: "application/json" },
            { name: "X-Goog-Api-Key", value: "={{ $vars.GOOGLE_PLACES_API_KEY }}" },
            {
              name: "X-Goog-FieldMask",
              value:
                "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.types,places.primaryTypeDisplayName,places.googleMapsUri,places.websiteUri,places.businessStatus",
            },
          ],
        },
        timeout: 15_000,
      },
    ),
    codeNode("Normalize Google Places", normalizePlacesCode, [544, -416]),
    codeNode("Rank Restaurant Options", rankRestaurantsCode, [800, -416]),
    respondNode("Return Restaurant Options", [1056, -416]),
    codeNode("Format Missing Preferences", formatMissingPreferencesCode, [288, -208]),
    respondNode("Return Planning Follow-up", [544, -208]),
    webhookNode("Submit Approved Restaurant", "dineline-calle-book", [-992, 176]),
    codeNode("Build Approved Booking Draft", buildApprovedBookingDraftCode, [-736, 176]),
    switchBooleanNode(
      "Switch Booking Ready",
      "={{ $json.ready }}",
      "ready",
      [-480, 176],
    ),
    httpNode(
      "Preview CALL-E Contract",
      "http://127.0.0.1:4173/api/preview",
      "={{ $json.draft }}",
      [-224, 96],
      { timeout: 10_000 },
    ),
    codeNode("Bind Approved Fingerprint", bindBookingApprovalCode, [32, 96]),
    httpNode(
      "Dispatch CALL-E Booking",
      "http://127.0.0.1:4173/api/n8n/dispatch",
      "={{ $json }}",
      [288, 96],
      { timeout: 330_000, retryOnFail: false },
    ),
    codeNode("Format Verified Booking Result", formatBookingResultCode, [544, 96]),
    codeNode("Format Booking Preflight", formatBookingPreflightCode, [-224, 256]),
    respondNode("Return Booking Result", [800, 176]),
  ];

  return workflow("DineLine CALL-E Edition - Native Two Agent", "DLECalleEdition01", nodes, {
    "Start CALL-E Dinner Plan": next("Validate Planning Request"),
    "Validate Planning Request": next("Preview CALL-E Intake Request"),
    "Preview CALL-E Intake Request": next("Bind CALL-E Intake Approval"),
    "Bind CALL-E Intake Approval": next("Dispatch CALL-E Preference Agent"),
    "Dispatch CALL-E Preference Agent": next("Switch Preferences Ready"),
    "Switch Preferences Ready": {
      main: [[target("Google Places Text Search")], [target("Format Missing Preferences")]],
    },
    "Google Places Text Search": next("Normalize Google Places"),
    "Normalize Google Places": next("Rank Restaurant Options"),
    "Rank Restaurant Options": next("Return Restaurant Options"),
    "Format Missing Preferences": next("Return Planning Follow-up"),
    "Submit Approved Restaurant": next("Build Approved Booking Draft"),
    "Build Approved Booking Draft": next("Switch Booking Ready"),
    "Switch Booking Ready": {
      main: [[target("Preview CALL-E Contract")], [target("Format Booking Preflight")]],
    },
    "Preview CALL-E Contract": next("Bind Approved Fingerprint"),
    "Bind Approved Fingerprint": next("Dispatch CALL-E Booking"),
    "Dispatch CALL-E Booking": next("Format Verified Booking Result"),
    "Format Verified Booking Result": next("Return Booking Result"),
    "Format Booking Preflight": next("Return Booking Result"),
  });
}

function buildFixtureRoundTripWorkflow() {
  const nodes = [
    {
      id: "ManualTrigger",
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [-1248, 0],
      parameters: {},
    },
    codeNode("Create CALL-E Intake Fixture", fixtureIntakeInputCode, [-992, 0]),
    httpNode(
      "Preview Intake Fixture",
      "http://127.0.0.1:4173/api/intake/preview",
      "={{ $json.request }}",
      [-736, 0],
      { timeout: 10_000 },
    ),
    codeNode("Bind Intake Fixture", bindFixtureIntakeCode, [-480, 0]),
    httpNode(
      "Dispatch Intake Fixture",
      "http://127.0.0.1:4173/api/n8n/intake/dispatch",
      "={{ $json }}",
      [-224, 0],
      { timeout: 150_000, retryOnFail: false },
    ),
    codeNode("Create Fixture Booking", createFixtureBookingCode, [32, 0]),
    httpNode(
      "Preview Fixture Contract",
      "http://127.0.0.1:4173/api/preview",
      "={{ $json.draft }}",
      [288, 0],
      { timeout: 10_000 },
    ),
    codeNode("Bind Fixture Booking", bindFixtureBookingCode, [544, 0]),
    httpNode(
      "Dispatch Booking Fixture",
      "http://127.0.0.1:4173/api/n8n/dispatch",
      "={{ $json }}",
      [800, 0],
      { timeout: 150_000, retryOnFail: false },
    ),
    codeNode("Assert Two Agent Round Trip", assertTwoAgentRoundTripCode, [1056, 0]),
  ];

  return workflow("DineLine CALL-E - Two Agent Fixture Round Trip", "DLECalleFixture01", nodes, {
    "Manual Trigger": next("Create CALL-E Intake Fixture"),
    "Create CALL-E Intake Fixture": next("Preview Intake Fixture"),
    "Preview Intake Fixture": next("Bind Intake Fixture"),
    "Bind Intake Fixture": next("Dispatch Intake Fixture"),
    "Dispatch Intake Fixture": next("Create Fixture Booking"),
    "Create Fixture Booking": next("Preview Fixture Contract"),
    "Preview Fixture Contract": next("Bind Fixture Booking"),
    "Bind Fixture Booking": next("Dispatch Booking Fixture"),
    "Dispatch Booking Fixture": next("Assert Two Agent Round Trip"),
  });
}

function workflow(name, id, nodes, connections) {
  return {
    id,
    name,
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    tags: [],
  };
}

function webhookNode(name, pathName, position) {
  return {
    id: compactId(name),
    name,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position,
    webhookId: `${compactId(name)}-sanitized`,
    parameters: {
      httpMethod: "POST",
      path: pathName,
      responseMode: "responseNode",
      options: {},
    },
  };
}

function codeNode(name, jsCode, position) {
  return {
    id: compactId(name),
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: { jsCode },
  };
}

function httpNode(name, url, jsonBody, position, options) {
  const { timeout, retryOnFail = false, ...extra } = options;
  return {
    id: compactId(name),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    retryOnFail,
    maxTries: 1,
    parameters: {
      method: "POST",
      url,
      ...extra,
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: { timeout },
    },
  };
}

function respondNode(name, position) {
  return {
    id: compactId(name),
    name,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.4,
    position,
    parameters: { options: { responseCode: 200 } },
  };
}

function switchBooleanNode(name, leftValue, outputKey, position) {
  return {
    id: compactId(name),
    name,
    type: "n8n-nodes-base.switch",
    typeVersion: 3,
    position,
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: "",
                typeValidation: "strict",
                version: 1,
              },
              conditions: [
                {
                  leftValue,
                  rightValue: true,
                  operator: { type: "boolean", operation: "true", singleValue: true },
                },
              ],
              combinator: "and",
            },
            renameOutput: true,
            outputKey,
          },
        ],
      },
      options: { fallbackOutput: "extra" },
    },
  };
}

function next(nodeName) {
  return { main: [[target(nodeName)]] };
}

function target(nodeName) {
  return { node: nodeName, type: "main", index: 0 };
}

function compactId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "");
}

const validatePlanningRequestCode = `const body = $json.body || $json;
const phone = String(body.phone || '').trim();
const sessionId = String(body.sessionId || '').trim();
const explicitConsent = body.explicitConsent === true;
const missing = [];
if (!/^\\+[1-9]\\d{7,14}$/.test(phone)) missing.push('phone_e164');
if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) missing.push('session_id');
if (!explicitConsent) missing.push('explicit_consent');
if (missing.length) throw new Error('Planning call blocked. Missing: ' + missing.join(', '));
return [{ json: {
  request: { phone, sessionId, explicitConsent: true },
  scenario: body.fixtureScenario || 'complete',
  source: {
    n8nExecutionId: String($execution.id),
    sourceCallId: 'planning:' + sessionId,
    toolCallId: null
  }
} }];`;

const bindIntakeApprovalCode = `const source = $('Validate Planning Request').first().json;
const preview = $json.preview;
if (!preview?.requestId || !preview?.correlationId) throw new Error('Intake preview did not return binding IDs.');
return [{ json: {
  request: source.request,
  approvedRequestId: preview.requestId,
  correlationId: preview.correlationId,
  source: source.source,
  scenario: source.scenario
} }];`;

const normalizePlacesCode = `function textValue(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.text || null;
}
function normalizePhone(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\\+[1-9]\\d{7,14}$/.test(raw)) return raw;
  const digits = raw.replace(/\\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}
const businesses = ($json.places || [])
  .filter((place) => place.businessStatus !== 'CLOSED_PERMANENTLY')
  .map((place) => ({
    id: place.id,
    name: textValue(place.displayName) || '',
    rating: place.rating || 0,
    review_count: place.userRatingCount || 0,
    phone: normalizePhone(place.internationalPhoneNumber || place.nationalPhoneNumber),
    address: place.formattedAddress || place.shortFormattedAddress || '',
    categories: [textValue(place.primaryTypeDisplayName), ...(place.types || [])]
      .filter(Boolean).slice(0, 4),
    price: place.priceLevel || null,
    url: place.googleMapsUri || place.websiteUri || null,
    provider: 'google_places'
  }))
  .filter((business) => business.name && business.address && business.phone);
return [{ json: { businesses } }];`;

const rankRestaurantsCode = `const intake = $('Dispatch CALL-E Preference Agent').first().json;
const top = ($json.businesses || [])
  .filter((business) => business.rating >= 4 && business.review_count >= 25)
  .sort((left, right) => (right.rating - left.rating) || (right.review_count - left.review_count))
  .slice(0, 5)
  .map((business, index) => ({ ...business, option_number: index + 1 }));
const cache = $getWorkflowStaticData('global');
cache.restaurantOptionsByPlan = cache.restaurantOptionsByPlan || {};
cache.restaurantOptionsByPlan[intake.requestId] = {
  savedAt: new Date().toISOString(),
  preferences: intake.planningResult.preferences,
  options: top
};
return [{ json: {
  planningRequestId: intake.requestId,
  correlationId: intake.correlationId,
  preferences: intake.planningResult.preferences,
  restaurantOptions: top,
  message: top.length
    ? 'Five restaurant options are ready for review.'
    : 'No bookable match was found. Widen the area or try another cuisine.',
  requiresUserSelection: true,
  requiresExplicitBookingApproval: true
} }];`;

const formatMissingPreferencesCode = `const response = $json;
return [{ json: {
  planningRequestId: response.requestId,
  correlationId: response.correlationId,
  preferences: response.planningResult.preferences,
  restaurantOptions: [],
  missingFields: response.planningResult.missingFields,
  message: response.planningResult.messageToUser,
  requiresUserInput: true,
  automaticRetryAllowed: false
} }];`;

const buildApprovedBookingDraftCode = `const body = $json.body || $json;
const planningRequestId = String(body.planningRequestId || '');
const selectedOptionId = String(body.selectedOptionId || body.optionId || '');
const explicitApproval = body.explicitApproval === true;
const cache = $getWorkflowStaticData('global');
const plan = cache.restaurantOptionsByPlan?.[planningRequestId] || null;
const selected = plan?.options?.find((option) => String(option.id) === selectedOptionId) || null;
const reservationInput = body.reservation || {};
const reservation = {
  date: String(reservationInput.date || plan?.preferences?.date || ''),
  time: String(reservationInput.time || plan?.preferences?.time || ''),
  timeZone: String(reservationInput.timeZone || plan?.preferences?.timeZone || 'America/New_York'),
  partySize: Number(reservationInput.partySize || plan?.preferences?.partySize || 0),
  guestName: String(reservationInput.guestName || body.guestName || ''),
  specialRequests: String(reservationInput.specialRequests || plan?.preferences?.atmosphere || '')
};
const missing = [];
if (!plan) missing.push('planning_request');
if (!selected) missing.push('selected_google_place');
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(reservation.date)) missing.push('date_yyyy_mm_dd');
if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(reservation.time)) missing.push('time_24_hour');
if (!Number.isInteger(reservation.partySize) || reservation.partySize < 1 || reservation.partySize > 20) missing.push('party_size');
if (!reservation.guestName) missing.push('guest_name');
if (!explicitApproval) missing.push('explicit_approval');
return [{ json: {
  ready: missing.length === 0,
  planningRequestId,
  draft: {
    restaurant: {
      name: selected?.name || '',
      address: selected?.address || '',
      phone: selected?.phone || ''
    },
    reservation,
    policy: { acceptAlternativeTime: false, leaveVoicemail: false, discloseAiCaller: true }
  },
  explicitApproval,
  source: {
    n8nExecutionId: String($execution.id),
    sourceCallId: planningRequestId ? 'plan:' + planningRequestId.slice(0, 24) : null,
    toolCallId: null
  },
  scenario: body.fixtureScenario || 'confirmed',
  preflightMessage: missing.length
    ? 'Booking call blocked. Still needed: ' + missing.join(', ') + '.'
    : null
} }];`;

const bindBookingApprovalCode = `const source = $('Build Approved Booking Draft').first().json;
const preview = $json.preview;
if (!source.ready || source.explicitApproval !== true) throw new Error('Booking approval was not explicit.');
if (!preview?.contractId || !preview?.correlationId) throw new Error('Booking preview did not return binding IDs.');
return [{ json: {
  draft: source.draft,
  approvedContractId: preview.contractId,
  correlationId: preview.correlationId,
  explicitApproval: true,
  source: source.source,
  scenario: source.scenario
} }];`;

const formatBookingResultCode = `const source = $('Build Approved Booking Draft').first().json;
const sent = $('Bind Approved Fingerprint').first().json;
const response = $json;
if (response.correlationId !== sent.correlationId) {
  throw new Error('CALL-E booking correlation ID changed during the n8n round trip.');
}
return [{ json: {
  planningRequestId: source.planningRequestId,
  bookingResult: response.bookingResult,
  trace: {
    correlationId: response.correlationId,
    contractId: response.contractId,
    n8nExecutionId: response.source.n8nExecutionId,
    providerCallId: response.provider.callId,
    journalState: response.state,
    automaticRetryAllowed: response.retryPolicy.automaticRetryAllowed
  }
} }];`;

const formatBookingPreflightCode = `return [{ json: {
  planningRequestId: $json.planningRequestId,
  bookingResult: {
    status: 'missing_or_unapproved',
    messageToUser: $json.preflightMessage,
    needsHumanReview: false
  }
} }];`;

const fixtureIntakeInputCode = `return [{ json: {
  request: {
    phone: '+12025550109',
    sessionId: 'fixture-intake-' + String($execution.id),
    explicitConsent: true
  },
  source: {
    n8nExecutionId: String($execution.id),
    sourceCallId: 'fixture-plan-' + String($execution.id),
    toolCallId: null
  },
  scenario: 'complete'
} }];`;

const bindFixtureIntakeCode = `const source = $('Create CALL-E Intake Fixture').first().json;
const preview = $json.preview;
return [{ json: {
  request: source.request,
  approvedRequestId: preview.requestId,
  correlationId: preview.correlationId,
  source: source.source,
  scenario: source.scenario
} }];`;

const createFixtureBookingCode = `const intake = $json;
if (!intake.planningResult?.usableForSearch) throw new Error('Fixture intake was not usable for search.');
const preferences = intake.planningResult.preferences;
return [{ json: {
  intake,
  draft: {
    restaurant: {
      name: 'Harbor Test Kitchen',
      address: '100 Example Avenue, New York, NY',
      phone: '+12025550143'
    },
    reservation: {
      date: preferences.date,
      time: preferences.time,
      timeZone: preferences.timeZone || 'America/New_York',
      partySize: preferences.partySize,
      guestName: 'Demo Guest',
      specialRequests: (preferences.atmosphere || '') + ' Fixture execution ' + String($execution.id)
    },
    policy: { acceptAlternativeTime: false, leaveVoicemail: false, discloseAiCaller: true }
  },
  source: {
    n8nExecutionId: String($execution.id),
    sourceCallId: 'fixture-plan-' + String($execution.id),
    toolCallId: null
  },
  scenario: 'confirmed'
} }];`;

const bindFixtureBookingCode = `const source = $('Create Fixture Booking').first().json;
const preview = $json.preview;
return [{ json: {
  draft: source.draft,
  approvedContractId: preview.contractId,
  correlationId: preview.correlationId,
  explicitApproval: true,
  source: source.source,
  scenario: source.scenario
} }];`;

const assertTwoAgentRoundTripCode = `const intakeSent = $('Bind Intake Fixture').first().json;
const intake = $('Dispatch Intake Fixture').first().json;
const bookingSent = $('Bind Fixture Booking').first().json;
const booking = $json;
if (intake.requestId !== intakeSent.approvedRequestId) throw new Error('Intake request fingerprint changed in n8n.');
if (intake.correlationId !== intakeSent.correlationId) throw new Error('Intake correlation ID changed in n8n.');
if (intake.state !== 'completed') throw new Error('Fixture intake did not complete.');
if (intake.planningResult.status !== 'preferences_ready') throw new Error('Fixture preferences were not ready.');
if (!intake.provider.callId) throw new Error('Fixture intake provider ID is missing.');
if (booking.contractId !== bookingSent.approvedContractId) throw new Error('Booking fingerprint changed in n8n.');
if (booking.correlationId !== bookingSent.correlationId) throw new Error('Booking correlation ID changed in n8n.');
if (booking.state !== 'completed') throw new Error('Fixture booking did not complete.');
if (booking.bookingResult.status !== 'booked') throw new Error('Fixture result was not booked.');
if (!booking.provider.callId) throw new Error('Fixture booking provider ID is missing.');
if (intake.retryPolicy.automaticRetryAllowed !== false) throw new Error('Intake automatic retry must remain disabled.');
if (booking.retryPolicy.automaticRetryAllowed !== false) throw new Error('Booking automatic retry must remain disabled.');
return [{ json: {
  verification: 'passed',
  agents: 2,
  intakeRequestId: intake.requestId,
  intakeCorrelationId: intake.correlationId,
  intakeProviderCallId: intake.provider.callId,
  bookingContractId: booking.contractId,
  bookingCorrelationId: booking.correlationId,
  bookingProviderCallId: booking.provider.callId,
  intakeJournalState: intake.state,
  bookingJournalState: booking.state,
  bookingStatus: booking.bookingResult.status,
  automaticRetryAllowed: false
} }];`;

await mkdir(outputDirectory, { recursive: true });
await writeWorkflow("dineline-calle-edition.workflow.json", buildIntegrationWorkflow());
await writeWorkflow(
  "dineline-calle-fixture-roundtrip.workflow.json",
  buildFixtureRoundTripWorkflow(),
);

console.log(`Generated two sanitized n8n workflows in ${outputDirectory}`);
