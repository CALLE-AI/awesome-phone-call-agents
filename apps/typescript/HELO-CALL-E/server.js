const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Demo timescale configuration: compress minutes down to seconds
const DEMO_MULTIPLIER_SEC_PER_MIN = 2.0; // e.g. 45 mins -> 90 seconds

// Keep active retry timeout handles separately to avoid circular JSON serialization issues
const activeRetryTimeouts = {};

// ─────────────────────────────────────────────────────────────────────────────
// REAL CALL BUDGET — hard cap to prevent runaway API spend during hackathon
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REAL_CALLS_PER_SESSION = 5; // hard cap: 5 real calle CLI calls per server session
let realCallsPlacedThisSession = 0;  // incremented ONLY when a real (non-mock) call is spawned

// Returns true if a real call may proceed; false (with reason) if the budget is exhausted.
function canPlaceRealCall() {
  if (realCallsPlacedThisSession >= MAX_REAL_CALLS_PER_SESSION) {
    return { allowed: false, reason: `Real call budget exhausted (${realCallsPlacedThisSession}/${MAX_REAL_CALLS_PER_SESSION} calls placed this session). Use Mock Mode to continue testing.` };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-BUSINESS PLATFORM DATA
// ─────────────────────────────────────────────────────────────────────────────

// In-memory businesses store
let businesses = [
  {
    id: 'biz-restaurant-demo',
    name: 'The Grand Bistro',
    type: 'restaurant',
    email: 'bistro@demo.helo',
    goalTemplate: null,
    createdAt: new Date().toISOString()
  },
  {
    id: 'biz-clinic-demo',
    name: 'City Medical Clinic',
    type: 'clinic',
    email: 'clinic@demo.helo',
    goalTemplate: null,
    createdAt: new Date().toISOString()
  }
];

// In-memory sessions store: { token: businessId }
let sessions = {};

// Goal templates for known business types
const GOAL_TEMPLATES = {
  restaurant: (b, biz) =>
    `Confirm or make a table booking for a party of 2 for ${b.name} at ${b.dateTime}. You MUST end the call by clearly stating one of these three outcomes in your summary: 'BOOKED', 'UNAVAILABLE', or 'UNCERTAIN'.`,
  clinic: (b, biz) =>
    `Confirm or reschedule a medical appointment for ${b.name} at ${b.dateTime}. You MUST end the call by clearly stating one of these three outcomes in your summary: 'BOOKED', 'UNAVAILABLE', or 'UNCERTAIN'.`,
};

// Resolve the call goal from the booking and its parent business.
// Priority: 1) business.goalTemplate override  2) known type template  3) generic fallback
function resolveGoal(booking, business) {
  if (business && business.goalTemplate) {
    return business.goalTemplate
      .replace(/{name}/g, booking.name)
      .replace(/{dateTime}/g, booking.dateTime)
      .replace(/{businessName}/g, business.name);
  }
  const typeFn = GOAL_TEMPLATES[business?.type?.toLowerCase()];
  if (typeFn) return typeFn(booking, business);
  // Generic fallback for any unrecognised business type
  return `You are calling on behalf of ${business?.name ?? 'a business'}. Please confirm the appointment or booking for ${booking.name} scheduled at ${booking.dateTime}. You MUST end the call by clearly stating one of these three outcomes in your summary: 'BOOKED', 'UNAVAILABLE', or 'UNCERTAIN'.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED BOOKING DATA (migrated: businessId added, all other fields unchanged)
// ─────────────────────────────────────────────────────────────────────────────

let bookings = [
  {
    id: "booking-mock-aarav",
    name: "Aarav Sharma",
    phone: "+917302042763",
    dateTime: "2026-08-25 16:30",
    status: "pending",
    isCalling: false,
    logs: ["Booking created. Ready to initiate mock CALL-E call."],
    error: null,
    rawResult: null,
    retryCount: 0,
    mockMode: true,
    type: 'restaurant',
    businessId: 'biz-restaurant-demo',
    createdAt: new Date().toISOString()
  },
  {
    id: "booking-1",
    name: "Dr. Angela Merkel",
    phone: "+491712345678",
    dateTime: "2026-08-15 14:00",
    status: "pending",
    isCalling: false,
    logs: ["Booking created. Waiting for confirmation call."],
    error: null,
    rawResult: null,
    retryCount: 0,
    type: 'restaurant',
    businessId: 'biz-restaurant-demo'
  },
  {
    id: "booking-2",
    name: "Elizabeth Bennet",
    phone: "+15550192834",
    dateTime: "2026-08-18 10:30",
    status: "booked",
    isCalling: false,
    logs: [
      "[10:30:00] Call started.",
      "[10:30:05] Connected to Elizabeth Bennet.",
      "[10:30:25] Customer confirmed slot availability.",
      "[10:30:45] Call completed. Outcome determined: BOOKED."
    ],
    error: null,
    rawResult: {
      ok: true,
      result: {
        structuredContent: {
          status: "COMPLETED",
          extracted: {
            booking_status: "BOOKED"
          }
        }
      }
    },
    retryCount: 0,
    type: 'restaurant',
    businessId: 'biz-restaurant-demo'
  },
  {
    id: "appointment-mock-tony",
    name: "Tony Stark",
    phone: "+15550182823",
    dateTime: "2026-08-22 15:00",
    status: "pending",
    isCalling: false,
    logs: ["Appointment created. Ready to initiate mock clinic CALL-E call."],
    error: null,
    rawResult: null,
    retryCount: 0,
    mockMode: true,
    type: 'clinic',
    businessId: 'biz-clinic-demo',
    createdAt: new Date().toISOString()
  },
  {
    id: "appointment-1",
    name: "Sherlock Holmes",
    phone: "+447962684620",
    dateTime: "2026-08-16 11:00",
    status: "pending",
    isCalling: false,
    logs: ["Appointment created. Waiting for confirmation call."],
    error: null,
    rawResult: null,
    retryCount: 0,
    type: 'clinic',
    businessId: 'biz-clinic-demo'
  },
  {
    id: "appointment-2",
    name: "Bruce Wayne",
    phone: "+15550199182",
    dateTime: "2026-08-19 09:00",
    status: "pending",
    isCalling: false,
    logs: ["Appointment created. Waiting for confirmation call."],
    error: null,
    rawResult: null,
    retryCount: 0,
    type: 'clinic',
    businessId: 'biz-clinic-demo'
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

function requireSession(req, res, next) {
  const token = req.headers['x-session-token'];
  const bizId = token && sessions[token];
  if (!bizId) return res.status(401).json({ error: 'No valid session. Please log in.' });
  req.businessId = bizId;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLE ENGINE HELPERS (UNCHANGED)
// ─────────────────────────────────────────────────────────────────────────────

// Helper to run a CALL-E CLI command via child_process.spawn
function runCalleCommand(args) {
  return new Promise((resolve, reject) => {
    try {
      // Always append --json so calle outputs machine-readable JSON.
      // Also set generous timeouts so MCP requests don't time out during real call planning.
      const allArgs = [...args, '--json', '--timeout-seconds', '120', '--poll-timeout-seconds', '120'];

      // Map arguments to handle spaces and quotes correctly under Windows shell
      const formattedArgs = allArgs.map(arg => {
        if (arg.includes(' ') || arg.includes("'") || arg.includes('"')) {
          return `"${arg.replace(/"/g, '\\"')}"`;
        }
        return arg;
      });
      const cmd = `calle ${formattedArgs.join(' ')}`;
      console.log(`Spawning command string: ${cmd}`);
      
      const child = spawn(cmd, {
        env: {
          ...process.env,
          CALLE_SOURCE: 'skills_sh',
          CALLE_INTEGRATION: 'skills_sh_skill',
          CALLE_INTEGRATION_VERSION: '0.1.0'
        },
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle async spawn execution errors (e.g. command not found)
      child.on('error', (err) => {
        console.error("Child process execution error event:", err);
        reject(err);
      });

      child.on('close', (code) => {
        // Always try to parse stdout as JSON first — calle emits { ok: false } on failures too
        const rawOut = stdout.trim();
        if (rawOut) {
          try {
            const json = JSON.parse(rawOut);
            // Resolve with the parsed object regardless of exit code.
            // Callers check json.ok to detect logical failures.
            resolve(json);
            return;
          } catch (_parseErr) {
            // stdout wasn't valid JSON — fall through to error handling below
          }
        }

        if (code !== 0) {
          reject(new Error(`calle exited with code ${code}. Stderr: ${stderr.trim() || 'No stderr details'}`));
        } else {
          reject(new Error(`calle produced no JSON output. Stderr: ${stderr.trim() || 'none'}`));
        }
      });
    } catch (err) {
      // Handle sync spawn errors
      console.error("Synchronous spawn error:", err);
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/login  { email } → { token, business }
app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const business = businesses.find(b => b.email.toLowerCase() === email.trim().toLowerCase());
  if (!business) {
    return res.status(404).json({ error: 'No business found for that email. Please register first.' });
  }

  const token = uuidv4();
  sessions[token] = business.id;
  console.log(`[AUTH] Login: ${email} → ${business.id} (token: ${token})`);
  res.json({ token, business });
});

// POST /api/auth/logout  { token }
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'] || req.body?.token;
  if (token && sessions[token]) {
    console.log(`[AUTH] Logout: token ${token} (was ${sessions[token]})`);
    delete sessions[token];
  }
  res.json({ message: 'Logged out.' });
});

// GET /api/auth/me  → { business }
app.get('/api/auth/me', requireSession, (req, res) => {
  const business = businesses.find(b => b.id === req.businessId);
  if (!business) return res.status(404).json({ error: 'Business not found.' });
  res.json({ business });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/businesses  — list all (admin/demo, no session required)
app.get('/api/businesses', (req, res) => {
  res.json(businesses);
});

// POST /api/businesses  — register a new business
app.post('/api/businesses', (req, res) => {
  const { name, type, email, goalTemplate } = req.body;
  if (!name || !type || !email) {
    return res.status(400).json({ error: 'Missing required fields: name, type, email' });
  }

  // Check for duplicate email
  if (businesses.find(b => b.email.toLowerCase() === email.trim().toLowerCase())) {
    return res.status(409).json({ error: 'A business with that email already exists. Try logging in instead.' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const newBusiness = {
    id: `biz-${slug}-${Date.now()}`,
    name: name.trim(),
    type: type.trim(),
    email: email.trim().toLowerCase(),
    goalTemplate: goalTemplate ? goalTemplate.trim() : null,
    createdAt: new Date().toISOString()
  };

  businesses.push(newBusiness);

  // Auto-create a session for the new business
  const token = uuidv4();
  sessions[token] = newBusiness.id;
  console.log(`[BUSINESS] Registered: ${newBusiness.name} (${newBusiness.id})`);

  res.status(201).json({ token, business: newBusiness });
});

// GET /api/businesses/:bizId/bookings  — session required
app.get('/api/businesses/:bizId/bookings', requireSession, (req, res) => {
  const { bizId } = req.params;

  // Admin override: session holder can view any business if ?admin=1
  const isAdmin = req.query.admin === '1';
  if (!isAdmin && req.businessId !== bizId) {
    return res.status(403).json({ error: 'Access denied: this is not your business.' });
  }

  const result = bookings.filter(b => b.businessId === bizId);
  res.json(result);
});

// POST /api/businesses/:bizId/bookings  — session required
app.post('/api/businesses/:bizId/bookings', requireSession, (req, res) => {
  const { bizId } = req.params;

  const isAdmin = req.query.admin === '1';
  if (!isAdmin && req.businessId !== bizId) {
    return res.status(403).json({ error: 'Access denied: this is not your business.' });
  }

  const business = businesses.find(b => b.id === bizId);
  if (!business) return res.status(404).json({ error: 'Business not found.' });

  const { name, phone, dateTime, mockMode } = req.body;
  if (!name || !phone || !dateTime) {
    return res.status(400).json({ error: 'Missing required fields: name, phone, dateTime' });
  }

  const newBooking = {
    id: `record-${uuidv4()}`,
    name: name.trim(),
    phone: phone.trim(),
    dateTime,
    status: 'pending',
    isCalling: false,
    logs: [`Record created for ${business.name}. Ready to initiate CALL-E call.`],
    error: null,
    rawResult: null,
    retryCount: 0,
    type: business.type,
    businessId: bizId,
    mockMode: mockMode === true || mockMode === 'true',
    createdAt: new Date().toISOString()
  };

  bookings.push(newBooking);
  res.status(201).json(newBooking);
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY UNSCOPED BOOKING ROUTES (engine-internal, kept intact)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/bookings — optional ?businessId= filter, no session required (internal use)
app.get('/api/bookings', (req, res) => {
  const { businessId } = req.query;
  res.json(businessId ? bookings.filter(b => b.businessId === businessId) : bookings);
});

// POST /api/bookings — legacy creation (kept for backwards compat)
app.post('/api/bookings', (req, res) => {
  const { name, phone, dateTime, type } = req.body;
  if (!name || !phone || !dateTime) {
    return res.status(400).json({ error: "Missing required fields: name, phone, dateTime" });
  }

  const isClinic = type === 'clinic';
  const newBooking = {
    id: `${isClinic ? 'appointment' : 'booking'}-${uuidv4()}`,
    name,
    phone,
    dateTime,
    status: 'pending',
    isCalling: false,
    logs: [`${isClinic ? 'Appointment' : 'Booking'} created. Ready to initiate CALL-E call.`],
    error: null,
    rawResult: null,
    retryCount: 0,
    type: type || 'restaurant',
    businessId: type === 'clinic' ? 'biz-clinic-demo' : 'biz-restaurant-demo',
    createdAt: new Date().toISOString()
  };

  bookings.push(newBooking);
  res.status(201).json(newBooking);
});

// API: Start call for a booking
app.post('/api/bookings/:id/call', (req, res) => {
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  if (booking.isCalling) {
    return res.status(400).json({ error: "Call is already in progress for this booking." });
  }

  // ── Real call budget pre-check (manual click path) ──
  // Mock calls skip this check entirely — the mockMode flag is inspected inside
  // executeCallWorkflow before the real CLI spawn, but we surface the block here
  // immediately for the manual trigger so the UI gets a clean error response.
  if (!booking.mockMode) {
    const budget = canPlaceRealCall();
    if (!budget.allowed) {
      return res.status(429).json({ error: budget.reason });
    }
  }

  // Clear any pending retry schedules
  if (activeRetryTimeouts[booking.id]) {
    console.log(`[OVERRIDE] Manual call triggered for booking ${booking.id}. Clearing pending retry timeout.`);
    clearTimeout(activeRetryTimeouts[booking.id]);
    delete activeRetryTimeouts[booking.id];
  }

  // Set calling flags immediately
  booking.isCalling = true;
  booking.status = 'calling';
  booking.error = null;
  booking.rawResult = null;
  booking.logs = ["[System] Initializing phone call request..."];

  // Start the calling workflow in the background
  // Wrap the call launch in try/catch to ensure we don't leave booking stuck if spawning fails
  executeCallWorkflow(booking).catch(err => {
    console.error(`Unhandled error in executeCallWorkflow for ${booking.id}:`, err);
    booking.isCalling = false;
    booking.status = 'failed';
    booking.error = `Unhandled system error: ${err.message}`;
    booking.logs.push(`[System Error] ${err.message}`);
  });

  // Respond 200 immediately so UI knows the request was received and is processing
  res.json({ message: "Call initiated", booking });
});

// GET /api/calls/budget — returns current real call spend vs cap
app.get('/api/calls/budget', (req, res) => {
  res.json({
    used: realCallsPlacedThisSession,
    cap:  MAX_REAL_CALLS_PER_SESSION,
    remaining: MAX_REAL_CALLS_PER_SESSION - realCallsPlacedThisSession,
    exhausted: realCallsPlacedThisSession >= MAX_REAL_CALLS_PER_SESSION
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLE ENGINE (UNCHANGED — only goal derivation updated to use resolveGoal)
// ─────────────────────────────────────────────────────────────────────────────

// Main CALL-E calling background routine
async function executeCallWorkflow(booking) {
  // Resolve the goal via business lookup + template resolution
  const business = businesses.find(b => b.id === booking.businessId);
  const goal = resolveGoal(booking, business);

  booking.logs.push(`Goal formulated: "${goal}"`);

  if (booking.mockMode) {
    booking.logs.push("[System] [MOCK] Simulating CALL-E agent for mockMode booking...");
    console.log(`[MOCK CALL START] Initiating simulated call for booking ${booking.id}`);
    
    // Simulate call status updates and final output after 2 seconds
    setTimeout(() => {
      booking.logs.push("[System] [MOCK] Call in progress...");
      booking.logs.push("[System] [MOCK] Call ended; syncing final Calling result.");
      
      const mockStatusResponse = {
        ok: true,
        result: {
          structuredContent: {
            run_id: `mock-run-${Date.now()}`,
            status: "DECLINED",
            message: "Outcome: UNCERTAIN. The call did not connect or complete; the recipient may be busy or unavailable. You can confirm retrying in about 45 minutes, provide a different retry time, or ask to retry immediately.",
            result: {
              summary: "Outcome: UNCERTAIN. The call did not connect or complete; the recipient may be busy or unavailable, so you can confirm retrying in about 45 minutes, provide a different retry time, or ask to retry immediately.",
              post_summary: "Outcome: UNCERTAIN. The call did not connect or complete; the recipient may be busy or unavailable, so you can confirm retrying in about 45 minutes, provide a different retry time, or ask to retry immediately.",
              outcome: {
                task_completed: false,
                completion_confidence: {
                  score: 0.82,
                  label: "high"
                }
              },
              extracted: {
                goal: goal,
                region: "IN",
                repair: {
                  decision: {
                    next_step: {
                      action: "ask_user_for_retry_confirmation",
                      plan_id: "pE7GAXHM9",
                      tool_name: "plan_call",
                      instruction: "Outcome: UNCERTAIN. The call did not connect or complete; the recipient may be busy or unavailable. You can confirm retrying in about 45 minutes, provide a different retry time, or ask to retry immediately.",
                      parent_run_id: "mock-parent-run-id",
                      required_user_input: []
                    },
                    repair_type: "no_answer",
                    execution_mode: "time_shift_retry",
                    required_user_input: [],
                    schedule_suggestion: {
                      confidence: "medium",
                      retry_strategy: "short_delay",
                      retry_after_reason: "The recipient may be temporarily busy or unavailable.",
                      requested_delay_minutes: null
                    }
                  },
                  commit_metadata: {
                    child_run_id: null,
                    blocked_reasons: [],
                    committed_action: "none",
                    real_world_action_committed: false
                  }
                },
                calling: {
                  calls: [
                    {
                      status: "DECLINED",
                      duration_seconds: 0
                    }
                  ],
                  status: "DECLINED"
                }
              }
            }
          }
        }
      };

      booking.rawResult = mockStatusResponse;
      parseCallOutcome(booking, mockStatusResponse);
    }, 2000);
    return;
  }

  // ── Real call budget check (mock calls bypass this) ──
  const budget = canPlaceRealCall();
  if (!budget.allowed) {
    booking.isCalling = false;
    booking.status = 'failed';
    booking.error = budget.reason;
    booking.logs.push(`[System] ⛔ ${budget.reason}`);
    console.warn(`[BUDGET BLOCK] ${booking.id}: ${budget.reason}`);
    return;
  }

  realCallsPlacedThisSession += 1;
  console.log(`[BUDGET] Real call #${realCallsPlacedThisSession}/${MAX_REAL_CALLS_PER_SESSION} authorised for booking ${booking.id}`);

  booking.logs.push("[System] Spawning CALL-E agent via CLI...");

  let runId = null;

  try {
    // Attempt to start the CALL-E call
    // Spawning is wrapped in this try/catch block
    const startResponse = await runCalleCommand([
      'call', 'start',
      '--to-phone', booking.phone,
      '--goal', goal,
      '--language', 'English'
    ]);

    console.log(`[START RAW RESULT FOR ${booking.id}]:`, JSON.stringify(startResponse, null, 2));

    if (!startResponse.ok) {
      throw new Error(startResponse.error?.message || 'CLI start command reported failure');
    }

    runId = startResponse.run_id;
    booking.logs.push(`[System] Call spawned successfully. Run ID: ${runId}`);

    // Update with initial activity if any
    const initialContent = startResponse.status_result?.structuredContent || startResponse.result?.structuredContent;
    if (initialContent) {
      updateBookingProgress(booking, initialContent);
    }

    // Begin background status polling loop
    pollCallStatus(booking, runId);

  } catch (err) {
    // If the spawn fails or command fails, flip isCalling back to false and log failure
    console.error(`[SPAWN/START FAILURE FOR BOOKING ${booking.id}]:`, err);
    booking.isCalling = false;
    booking.status = 'failed';
    booking.error = `Failed to start call: ${err.message}`;
    booking.logs.push(`[System Failure] ${err.message}`);
  }
}

// Background status polling loop
async function pollCallStatus(booking, runId) {
  const delay = (ms) => new Promise(res => setTimeout(res, ms));
  const terminalStatuses = ['COMPLETED', 'FAILED', 'NO_ANSWER', 'DECLINED', 'CANCELED', 'CANCELLED', 'VOICEMAIL', 'BUSY', 'EXPIRED'];

  while (booking.isCalling) {
    await delay(10000); // Poll every 10 seconds

    // Double check if booking calling state was changed externally
    if (!booking.isCalling) break;

    try {
      const statusResponse = await runCalleCommand([
        'call', 'status',
        '--run-id', runId
      ]);

      if (!statusResponse.ok) {
        throw new Error(statusResponse.error?.message || 'CLI status query failed');
      }

      const structuredContent = statusResponse.result?.structuredContent;
      if (!structuredContent) {
        throw new Error('No structuredContent found in status response');
      }

      const currentStatus = structuredContent.status;
      
      // Update activity logs
      updateBookingProgress(booking, structuredContent);

      // Check if terminal
      if (terminalStatuses.includes(currentStatus)) {
        booking.logs.push(`[System] Call reached terminal status: ${currentStatus}`);
        
        // Log the final raw result JSON for live debugging
        console.log(`[RAW FINAL STATUS RESULT FOR ${booking.id}]:`, JSON.stringify(statusResponse, null, 2));
        booking.rawResult = statusResponse;

        // Parse outcome
        parseCallOutcome(booking, statusResponse);
        break;
      }

    } catch (err) {
      console.error(`[POLLING EXCEPTION FOR BOOKING ${booking.id}]:`, err);
      booking.logs.push(`[Polling Notice] ${err.message}. Retrying in 10s...`);
    }
  }
}

// Update booking logs with CALL-E activity items
function updateBookingProgress(booking, structuredContent) {
  if (structuredContent.activity && Array.isArray(structuredContent.activity)) {
    const newLogs = ["[System] Call in progress..."];
    structuredContent.activity.forEach(act => {
      const ts = act.ts ? `[${act.ts}] ` : '';
      newLogs.push(`${ts}${act.message}`);
    });
    booking.logs = newLogs;
  } else if (structuredContent.message) {
    booking.logs.push(structuredContent.message);
  }
}

// Parse outcome from call result with fallbacks
function parseCallOutcome(booking, statusResponse) {
  let outcome = null;
  let source = "";

  const result = statusResponse.result || {};
  const structuredContent = result.structuredContent || {};
  const innerResult = structuredContent.result || {};
  const extracted = innerResult.extracted || result.extracted || structuredContent.extracted || {};

  console.log(`[OUTCOME PARSING FOR BOOKING ${booking.id}]`);

  // 1. Check for a structured field in the response first (if CALL-E's CLI returns one)
  const structuredOutcomes = [
    extracted.outcome,
    extracted.booking_status,
    extracted.bookingOutcome,
    extracted.status,
    innerResult.outcome,
    result.outcome,
    structuredContent.outcome,
    innerResult.booking_status,
    result.booking_status,
    structuredContent.booking_status
  ];

  for (const field of structuredOutcomes) {
    if (field && typeof field === 'string') {
      const normalized = field.trim().toUpperCase();
      if (['BOOKED', 'UNAVAILABLE', 'UNCERTAIN'].includes(normalized)) {
        outcome = normalized;
        source = `Structured field ('${field}')`;
        break;
      }
    }
  }

  // Extract raw summary text to analyze
  const rawSummary = innerResult.summary || innerResult.post_summary || result.summary || result.post_summary || structuredContent.summary || structuredContent.post_summary || innerResult.message || result.message || structuredContent.message || "";

  // 2. Try explicit regex match if no structured outcome field matched
  if (!outcome) {
    console.log(`[OUTCOME PARSING] Raw summary text to analyze: "${rawSummary}"`);

    const explicitRegex = /Outcome:\s*(BOOKED|UNAVAILABLE|UNCERTAIN)/i;
    const regexMatch = rawSummary.match(explicitRegex);
    if (regexMatch) {
      outcome = regexMatch[1].toUpperCase();
      source = "Regex match: Outcome prefix";
    }
  }

  // 3. Fall back to word-boundary keyword matching (\b) in priority order: BOOKED, UNAVAILABLE, UNCERTAIN
  if (!outcome && rawSummary) {
    if (/\bBOOKED\b/i.test(rawSummary)) {
      outcome = 'BOOKED';
      source = "Word-boundary keyword match: BOOKED";
    } else if (/\bUNAVAILABLE\b/i.test(rawSummary)) {
      outcome = 'UNAVAILABLE';
      source = "Word-boundary keyword match: UNAVAILABLE";
    } else if (/\bUNCERTAIN\b/i.test(rawSummary)) {
      outcome = 'UNCERTAIN';
      source = "Word-boundary keyword match: UNCERTAIN";
    }
  }

  // 4. Default to UNCERTAIN and log a clear warning if classification fell through both methods
  if (!outcome) {
    outcome = 'UNCERTAIN';
    source = "Fallback default";
    console.warn(`[WARNING] Booking ${booking.id} outcome classification fell through both regex and word-boundary methods. Defaulting to UNCERTAIN. Raw summary: "${rawSummary}"`);
    booking.logs.push(`[System Warning] Outcome classification fell through regex and word-boundary checks. Defaulted to UNCERTAIN.`);
  }

  console.log(`[OUTCOME DETERMINED]: ${outcome} via ${source}`);
  booking.logs.push(`[System] Outcome determined: ${outcome} (via ${source})`);
  
  // Set isCalling to false
  booking.isCalling = false;

  // Check if retry is needed
  if (outcome === 'UNCERTAIN') {
    const repair = extracted.repair || {};
    const decision = repair.decision || {};
    const nextStep = decision.next_step || {};
    const scheduleSuggestion = decision.schedule_suggestion || {};

    console.log(`[REPAIR INSPECTED] Booking ID: ${booking.id}`);
    console.log(`- next_step.action: ${nextStep.action || 'none'}`);
    console.log(`- repair_type: ${decision.repair_type || 'none'}`);
    console.log(`- execution_mode: ${decision.execution_mode || 'none'}`);

    const isRetryAction = 
      (nextStep.action && nextStep.action.toLowerCase().includes('retry')) ||
      (decision.execution_mode && decision.execution_mode.toLowerCase().includes('retry')) ||
      nextStep.action === 'ask_user_for_retry_confirmation';

    if (isRetryAction) {
      if (!booking.retryCount) {
        booking.retryCount = 0;
      }

      if (booking.retryCount >= 2) {
        console.log(`[RETRY DECISION] Booking ${booking.id} retry decision: REJECTED (cap of 2 reached, count: ${booking.retryCount})`);
        console.log(`- Next action: Mark status 'needs_human_review'`);
        booking.logs.push(`[System] Cap of 2 retries reached. Stopping retries and marking for human review.`);
        booking.status = 'needs_human_review';
        return;
      }

      // Determine real delay
      let realDelayMinutes = null;
      if (typeof scheduleSuggestion.requested_delay_minutes === 'number') {
        realDelayMinutes = scheduleSuggestion.requested_delay_minutes;
      } else if (scheduleSuggestion.requested_delay_minutes) {
        const parsed = parseInt(scheduleSuggestion.requested_delay_minutes, 10);
        if (!isNaN(parsed)) realDelayMinutes = parsed;
      }

      if (realDelayMinutes === null) {
        const textToSearch = [
          nextStep.instruction,
          scheduleSuggestion.retry_after_reason,
          structuredContent.message,
          innerResult.summary
        ].filter(Boolean).join(' ');
        
        const match = textToSearch.match(/(\d+)\s*(?:minute|min)/i);
        if (match) {
          realDelayMinutes = parseInt(match[1], 10);
        }
      }

      if (realDelayMinutes === null) {
        realDelayMinutes = 45; // default fallback
      }

      const retryReasonText = scheduleSuggestion.retry_after_reason || "Recipient may have been busy or unavailable.";
      const demoDelaySeconds = Math.round(realDelayMinutes * DEMO_MULTIPLIER_SEC_PER_MIN);

      booking.retryCount += 1;
      booking.status = 'retry_scheduled';
      booking.realDelayMinutes = realDelayMinutes;
      booking.demoDelaySeconds = demoDelaySeconds;
      booking.retryReason = retryReasonText;
      booking.retryScheduledTime = new Date(Date.now() + demoDelaySeconds * 1000).toISOString();

      console.log(`[RETRY DECISION] Booking ${booking.id} retry decision: APPROVED`);
      console.log(`- Reasoning: ${retryReasonText}`);
      console.log(`- Next action: Schedule Retry #${booking.retryCount} in ${demoDelaySeconds} seconds (demo-compressed from ${realDelayMinutes} minutes)`);

      booking.logs.push(`[System] Retry #${booking.retryCount} scheduled. CALL-E suggested retrying — ${retryReasonText}. Retrying in ~${demoDelaySeconds}s (demo-compressed from ${realDelayMinutes} min).`);

      activeRetryTimeouts[booking.id] = setTimeout(() => {
        // Clean up timeout handle from map
        delete activeRetryTimeouts[booking.id];

        if (booking.status === 'retry_scheduled') {
          console.log(`[RETRY EXECUTION] Triggering scheduled retry #${booking.retryCount} for booking ${booking.id}...`);
          booking.isCalling = true;
          booking.status = 'calling';
          booking.error = null;
          booking.rawResult = null;
          booking.logs.push(`[System] Executing scheduled retry #${booking.retryCount}...`);

          executeCallWorkflow(booking).catch(err => {
            console.error(`Unhandled error in executeCallWorkflow for retry ${booking.id}:`, err);
            booking.isCalling = false;
            booking.status = 'failed';
            booking.error = `Unhandled system error during retry: ${err.message}`;
            booking.logs.push(`[System Error] ${err.message}`);
          });
        }
      }, demoDelaySeconds * 1000);
      
      return;
    } else {
      console.log(`[RETRY DECISION] Booking ${booking.id} retry decision: SKIPPED (no retry action suggested by CALL-E)`);
      console.log(`- Next action: Mark status 'uncertain'`);
      booking.logs.push(`[System] CALL-E did not suggest retrying. Marking outcome as uncertain.`);
    }
  }

  // Set the final booking status
  booking.status = outcome.toLowerCase();
}

// Background sweep escalation function
function checkAndEscalate() {
  const now = Date.now();
  const ESCALATION_THRESHOLD_MS = 30000; // 30 seconds of pending state triggers auto-calling

  const unconfirmed = bookings.filter(booking => {
    // Only escalate mockMode bookings or manually created new bookings that have a createdAt timestamp
    if (!booking.createdAt) return false; 
    
    const isPastThreshold = (now - new Date(booking.createdAt)) > ESCALATION_THRESHOLD_MS;
    return booking.status === 'pending' && !booking.isCalling && isPastThreshold;
  });

  if (unconfirmed.length > 0) {
    console.log(`[ESCALATION ENGINE] Found ${unconfirmed.length} pending record(s) past the 30s threshold. Escalating...`);
  }

  unconfirmed.forEach(booking => {
    console.log(`[ESCALATION] Automatically initiating call for ${booking.type} ${booking.id} (${booking.name})`);
    booking.logs.push(`[System] Auto-escalation threshold exceeded (30s). Automatically initiating call...`);

    // Lock resource synchronously
    booking.isCalling = true;
    booking.status = 'calling';
    booking.error = null;
    booking.rawResult = null;

    // Clear any scheduled retry timeouts
    if (activeRetryTimeouts[booking.id]) {
      clearTimeout(activeRetryTimeouts[booking.id]);
      delete activeRetryTimeouts[booking.id];
    }

    executeCallWorkflow(booking).catch(err => {
      console.error(`Unhandled error in auto-escalated executeCallWorkflow for ${booking.id}:`, err);
      booking.isCalling = false;
      booking.status = 'failed';
      booking.error = `Unhandled system error: ${err.message}`;
      booking.logs.push(`[System Error] ${err.message}`);
    });
  });
}

// Run checkAndEscalate loop every 10 seconds
setInterval(checkAndEscalate, 10000);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Serve landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Serve dashboard at /dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`HELO Voice Bridge server running on http://localhost:${PORT}`);
  console.log(`  Landing page: http://localhost:${PORT}/`);
  console.log(`  Dashboard:    http://localhost:${PORT}/dashboard`);
});
