/**
 * Simulated CALL-E for offline development and demo rehearsal.
 *
 * Returns canned outcomes keyed by node id so we can develop and rehearse the
 * entire flow without spending real calls. It deliberately includes tricky
 * cases so the verification, policy, and language-retry layers have something
 * to react to:
 *   - a resident who needs help (high urgency)
 *   - a no-answer / voicemail
 *   - a low-confidence result that should trip the confidence gate
 *   - a Spanish-only answer that should trigger language auto-retry
 *   - a chain node that reveals the next number in its structuredResult
 *   - a policy violation (a fee was agreed) for the policy layer to catch
 */

import type {
  CalleCallOutcome,
  TranscriptTurn,
} from "../src/graph/types.js";
import type { CalleClient, CalleCallRequest } from "../src/calle/client.js";

function turns(...pairs: [TranscriptTurn["speaker"], string][]): TranscriptTurn[] {
  return pairs.map(([speaker, text], i) => ({ speaker, text, at: i * 4 }));
}

/** Small artificial latency so concurrency behaviour is observable in demos. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CannedFactory = (req: CalleCallRequest) => CalleCallOutcome;

/**
 * Canned outcomes keyed by node id. A factory receives the request so it can
 * react to things like the current locale (for language-retry simulation).
 */
const CANNED: Record<string, CannedFactory> = {
  // ---- Reachback fan-out residents ----
  "reachback-1": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.94, reason: "Clear answers to all questions." },
    structuredResult: { safe: true, has_power: true, needs: [], urgency: "none" },
    evidence: ["I'm fine, power's back on, don't need anything."],
    transcript: turns(
      ["agent", "Hi, this is a welfare check after the outage. Are you safe?"],
      ["callee", "Yes, I'm fine, power's back on, don't need anything."]
    ),
  }),

  "reachback-2": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.91, reason: "Resident reported an urgent need." },
    structuredResult: {
      safe: true,
      has_power: false,
      needs: ["medication", "water"],
      urgency: "high",
    },
    evidence: [
      "No power since yesterday and I'm out of my heart medication.",
      "Could really use some water too.",
    ],
    transcript: turns(
      ["agent", "Are you safe, and do you have power?"],
      ["callee", "I'm okay but no power since yesterday and I'm out of my heart medication. Could use water too."]
    ),
  }),

  "reachback-3": () => ({
    status: "no_answer",
    taskCompleted: false,
    completionConfidence: { score: 0.0, reason: "No answer after 6 rings." },
    transcript: turns(["system", "No answer after 6 rings."]),
  }),

  "reachback-4": () => ({
    status: "voicemail",
    taskCompleted: false,
    completionConfidence: { score: 0.1, reason: "Reached voicemail; left callback message." },
    evidence: ["Voicemail greeting detected."],
    transcript: turns(
      ["system", "Voicemail detected."],
      ["agent", "This is a welfare check, please call us back if you need help."]
    ),
  }),

  // Low-confidence: CALL-E isn't sure it understood; verification should flag.
  "reachback-5": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.42, reason: "Line noisy, answers partial." },
    structuredResult: { safe: true, has_power: true, needs: [], urgency: "low" },
    evidence: ["...fine ... think so ... hard to hear"],
    transcript: turns(
      ["agent", "Are you safe and do you have power?"],
      ["callee", "...fine ... think so ... [line noise]"]
    ),
  }),

  // Spanish-only answer on first (en-US) attempt -> triggers language retry.
  // On the es-MX retry, returns a clean high-confidence result.
  "reachback-6": (req) => {
    if (req.locale.startsWith("es")) {
      return {
        status: "completed",
        taskCompleted: true,
        completionConfidence: { score: 0.9, reason: "Clear answers in Spanish." },
        structuredResult: {
          safe: true,
          has_power: false,
          needs: ["water"],
          urgency: "medium",
        },
        evidence: ["Estoy bien pero no tengo luz, necesito agua."],
        transcript: turns(
          ["agent", "Hola, esta es una llamada de bienestar. ¿Está a salvo?"],
          ["callee", "Sí, estoy bien pero no tengo luz, necesito agua."]
        ),
      };
    }
    // First attempt in English: low confidence + language-barrier evidence.
    return {
      status: "completed",
      taskCompleted: false,
      completionConfidence: {
        score: 0.3,
        reason: "Callee responded in Spanish; language barrier suspected.",
      },
      evidence: ["No entiendo, ¿habla español?"],
      transcript: turns(
        ["agent", "Hi, this is a welfare check. Are you safe?"],
        ["callee", "No entiendo, ¿habla español?"]
      ),
    };
  },

  "reachback-7": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.88, reason: "Clear answers." },
    structuredResult: { safe: true, has_power: true, needs: [], urgency: "none" },
    evidence: ["All good here, thanks for checking."],
    transcript: turns(
      ["agent", "Just checking in after the outage — all good?"],
      ["callee", "All good here, thanks for checking."]
    ),
  }),

  "reachback-8": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.86, reason: "Resident reports being unsafe." },
    structuredResult: {
      safe: false,
      has_power: false,
      needs: ["welfare_visit"],
      urgency: "high",
    },
    evidence: ["I fell and I can't get up, no one's here."],
    transcript: turns(
      ["agent", "Are you safe?"],
      ["callee", "No — I fell and I can't get up, no one's here."]
    ),
  }),

  // ---- Runaround chain nodes (used later in step 4) ----
  "runaround-clinic": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.9 },
    structuredResult: {
      next_step: "gp_referral",
      referral_phone: "+14155550142",
      note: "Specialist requires a GP referral before booking.",
    },
    evidence: ["We can't book you without a referral from your GP."],
    transcript: turns(
      ["agent", "I'd like to book an appointment with the specialist."],
      ["callee", "We can't book you without a referral from your GP. Their number is 415-555-0142."]
    ),
  }),

  "runaround-gp": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.89 },
    structuredResult: {
      next_step: "insurer_preauth",
      insurer_phone: "+14155550188",
      note: "GP will send referral once insurer pre-authorizes.",
    },
    evidence: ["We'll send the referral, but your insurer needs to pre-authorize first."],
    transcript: turns(
      ["agent", "The specialist needs a referral."],
      ["callee", "We'll send it, but your insurer must pre-authorize. Call them at 415-555-0188."]
    ),
  }),

  // Insurer node includes a fee mention -> policy layer should flag it.
  "runaround-insurer": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.83 },
    structuredResult: {
      next_step: "book_clinic",
      preauth_code: "PA-99183",
      fee_mentioned: true,
      note: "Pre-auth granted; a $40 processing fee was mentioned.",
    },
    evidence: [
      "Your pre-authorization code is PA-99183.",
      "There is a $40 processing fee — shall I charge it now?",
    ],
    transcript: turns(
      ["agent", "I need pre-authorization for the specialist visit."],
      ["callee", "Approved. Code PA-99183. There's a $40 processing fee, shall I charge it now?"],
      ["agent", "I'm not authorized to agree to fees; please note it and we'll follow up."]
    ),
  }),

  "runaround-book": () => ({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.92 },
    structuredResult: {
      next_step: "done",
      confirmation_number: "APPT-20726",
      note: "Appointment booked with pre-auth code.",
    },
    evidence: ["You're booked. Confirmation number APPT-20726."],
    transcript: turns(
      ["agent", "I have pre-auth code PA-99183 and a referral. I'd like to book."],
      ["callee", "Great, you're booked. Confirmation number APPT-20726."]
    ),
  }),
};

/** Default outcome for any node id without a specific canned entry. */
function defaultOutcome(): CalleCallOutcome {
  return {
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.8, reason: "Generic completed call." },
    structuredResult: {},
    evidence: [],
    transcript: turns(["agent", "Call completed."]),
  };
}

/** GP / clinic follow-up call spawned when a resident needs help. */
function gpOutcome(): CalleCallOutcome {
  return {
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.9, reason: "Clinic logged the request." },
    structuredResult: {
      request_logged: true,
      callback_eta: "within 2 hours",
      reference_number: "GP-40881",
      note: "Clinic will dispatch a welfare check-in and call the resident back.",
    },
    evidence: [
      "Got it, we'll arrange a check-in. Your reference is GP-40881.",
      "Someone will call back within two hours.",
    ],
    transcript: turns(
      ["agent", "A resident from the outage welfare check needs a follow-up."],
      ["callee", "Understood. Reference GP-40881, we'll call back within two hours."]
    ),
  };
}

/** Emergency-contact call spawned when a resident is unreachable. */
function emergencyContactOutcome(): CalleCallOutcome {
  return {
    status: "completed",
    taskCompleted: true,
    completionConfidence: {
      score: 0.9,
      reason: "Emergency contact agreed to check in.",
    },
    structuredResult: {
      contact_reached: true,
      will_check_in: true,
      eta: "within 30 minutes",
      note: "Contact lives nearby and will go check on the resident in person.",
    },
    evidence: [
      "Oh no, I'll head over right now to check on them.",
      "I can be there in about half an hour.",
    ],
    transcript: turns(
      ["agent", "We couldn't reach your relative for a welfare check after the outage. Could you check on them?"],
      ["callee", "Of course, I live nearby. I'll go over within half an hour."]
    ),
  };
}

export interface MockTiming {
  /** Minimum simulated call duration (ms). */
  minDelayMs?: number;
  /** Maximum simulated call duration (ms). */
  maxDelayMs?: number;
}

export class MockCalleClient implements CalleClient {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  /**
   * By default calls finish quickly (good for tests). For a live "timelapse"
   * demo, pass a wide range (e.g. 4000-30000) so mock results trickle in over
   * time instead of all landing at once.
   */
  constructor(timing: MockTiming = {}) {
    this.minDelayMs = timing.minDelayMs ?? 300;
    this.maxDelayMs = timing.maxDelayMs ?? 500;
  }

  async createAndWait(req: CalleCallRequest): Promise<CalleCallOutcome> {
    // Random duration in [min, max] so concurrent calls finish gradually and in
    // varied order, like real telephony.
    const span = Math.max(0, this.maxDelayMs - this.minDelayMs);
    await delay(this.minDelayMs + Math.floor(Math.random() * (span + 1)));
    // Follow-up nodes are spawned dynamically (gp-<id>, ec-<id>), so match by
    // prefix rather than an exact canned entry.
    if (req.nodeId?.startsWith("gp-")) return gpOutcome();
    if (req.nodeId?.startsWith("ec-")) return emergencyContactOutcome();
    const factory = (req.nodeId && CANNED[req.nodeId]) || undefined;
    return factory ? factory(req) : defaultOutcome();
  }
}
