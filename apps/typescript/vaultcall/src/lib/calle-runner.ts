import { CalleClient } from '@call-e/calle';
import { store } from './store';
import { evaluateAirgapPolicy } from './airgap-gate';
import { compileCalleTask } from './calle-compiler';
import { reconcileTranscriptEvidence } from './evidence-scorer';
import { VerificationRecord, TranscriptTurn, CalleExtractionResult } from './types';
import {
  isValidAsciiE164,
  normalizeToAsciiE164,
  maskPhoneNumber,
  isAuthorizedLiveRecipient,
  validateApprovedHttpsOrigin,
} from './phone-utils';

export interface DispatchOptions {
  simulationScenario?: 'CONFIRM_VALID' | 'SIMULATE_FRAUD' | 'SIMULATE_GATEKEEPER';
  useLiveCalle?: boolean;
  apiKeyOverride?: string;
  targetPhoneOverride?: string;
  officerNameOverride?: string;
}

/**
 * Dispatches an out-of-band verification call via CALL-E or runs high-fidelity fixture simulation.
 */
export async function dispatchVerificationCall(
  recordId: string,
  options: DispatchOptions = {}
): Promise<VerificationRecord> {
  const record = store.getVerification(recordId);
  if (!record) {
    throw new Error(`Verification record ${recordId} not found.`);
  }

  if (store.getKillSwitch()) {
    throw new Error('EMERGENCY KILL SWITCH IS ACTIVE. Outbound dialing blocked.');
  }

  // 1. Evaluate Airgap Policy
  const gateResult = evaluateAirgapPolicy(record.vendor, record.request);
  if (!gateResult.passed) {
    record.status = 'GATEKEEPER_HOLD';
    record.airgapResult = gateResult;
    record.auditNotes.push(`Airgap Policy Rejection: ${gateResult.rejectionReason}`);
    store.saveVerification(record);
    return record;
  }

  record.airgapResult = gateResult;
  record.status = 'IN_PROGRESS';
  store.saveVerification(record);

  // 2. Compile CALL-E Task
  const task = compileCalleTask(record.vendor, record.request, gateResult);

  // 3. Live CALL-E execution
  const apiKey = options.apiKeyOverride || process.env.CALLE_API_KEY;
  if (options.useLiveCalle) {
    if (!apiKey) {
      record.status = 'GATEKEEPER_HOLD';
      record.auditNotes.push('Live call requested but CALLE_API_KEY is not configured. Kept as UNKNOWN.');
      store.saveVerification(record);
      throw new Error('CALL-E API Key required for live phone call. Please provide a valid key.');
    }

    try {
      return await executeLiveCalleCall(record, task, gateResult.challengeToken, options);
    } catch (err: any) {
      // Fail closed: Keep failed or ambiguous live results UNKNOWN rather than falling back to successful fixtures!
      record.status = 'GATEKEEPER_HOLD';
      record.certificate = undefined;
      record.auditNotes.push(`Live CALL-E Error: ${err.message}. Transaction kept in UNKNOWN hold state.`);
      record.updatedAt = new Date().toISOString();
      store.saveVerification(record);
      throw err;
    }
  }

  // 4. Deterministic Simulation Execution (Judge Fast-Path)
  return await executeSimulatedRun(record, task, gateResult.challengeToken, options.simulationScenario);
}

async function executeSimulatedRun(
  record: VerificationRecord,
  task: any,
  challengeToken: string,
  scenario?: 'CONFIRM_VALID' | 'SIMULATE_FRAUD' | 'SIMULATE_GATEKEEPER'
): Promise<VerificationRecord> {
  const targetScenario =
    scenario ||
    (record.vendor.id === 'VEND-002'
      ? 'SIMULATE_FRAUD'
      : record.vendor.id === 'VEND-003'
      ? 'SIMULATE_GATEKEEPER'
      : 'CONFIRM_VALID');

  const maskedPhone = maskPhoneNumber(record.airgapResult.targetDialNumber);
  let transcript: TranscriptTurn[];
  let extraction: CalleExtractionResult;

  if (targetScenario === 'SIMULATE_FRAUD') {
    transcript = [
      {
        index: 1,
        speaker: 'agent',
        text: `Security verification call for ${record.vendor.authorizedOfficer.name}, ${record.vendor.authorizedOfficer.title} at ${record.vendor.name}. Security reference ${challengeToken}.`,
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: `This is ${record.vendor.authorizedOfficer.name}. What is this regarding?`,
        timestampOffsetMs: 4100,
        isEvidenceAnchor: true,
      },
      {
        index: 3,
        speaker: 'agent',
        text: `We received an urgent wire instruction update claiming payments should route to ${record.request.newBankName}. Can you confirm your Tax ID and if this change was authorized?`,
        timestampOffsetMs: 9200,
      },
      {
        index: 4,
        speaker: 'callee',
        text: `Our Tax ID ends in ${record.vendor.taxEinLast4}, but wait—what did you say?! We NEVER requested any banking change! That is fraudulent! DO NOT send that money!`,
        timestampOffsetMs: 18400,
        isEvidenceAnchor: true,
      },
      {
        index: 5,
        speaker: 'agent',
        text: `Fraud detected and payment frozen immediately under reference ${challengeToken}. Security incident logged.`,
        timestampOffsetMs: 27000,
      },
    ];

    extraction = {
      spoke_with_authorized_officer: true,
      officer_name_stated: record.vendor.authorizedOfficer.name,
      officer_title_stated: record.vendor.authorizedOfficer.title,
      ein_last4_matched: true,
      verbal_bank_change_status: 'FRAUD_REJECTED',
      challenge_token_acknowledged: true,
      direct_quote_reason: 'ABSOLUTELY NOT! That is fraudulent! DO NOT send that money! We never authorized this change.',
      confidence_score: 0.99,
    };
  } else if (targetScenario === 'SIMULATE_GATEKEEPER') {
    transcript = [
      {
        index: 1,
        speaker: 'agent',
        text: `Hello, this is VaultCall accounts payable security calling ${record.vendor.name} regarding security reference ${challengeToken}. May I speak with ${record.vendor.authorizedOfficer.name}?`,
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: `Thank you for calling ${record.vendor.name}. The officer is currently out of office. Please leave a voicemail at the tone.`,
        timestampOffsetMs: 5200,
        isEvidenceAnchor: true,
      },
    ];

    extraction = {
      spoke_with_authorized_officer: false,
      officer_name_stated: '',
      officer_title_stated: '',
      ein_last4_matched: false,
      verbal_bank_change_status: 'CALL_BACK_REQUESTED',
      challenge_token_acknowledged: false,
      direct_quote_reason: 'Reached automated voicemail greeting; officer unavailable.',
      confidence_score: 0.85,
    };
  } else {
    // CONFIRM_VALID
    transcript = [
      {
        index: 1,
        speaker: 'agent',
        text: `Hello, this is the Enterprise Treasury Verification Desk. May I speak with ${record.vendor.authorizedOfficer.name} regarding security reference ${challengeToken}?`,
        timestampOffsetMs: 0,
      },
      {
        index: 2,
        speaker: 'callee',
        text: `Yes, this is ${record.vendor.authorizedOfficer.name} speaking. How can I help you?`,
        timestampOffsetMs: 3800,
        isEvidenceAnchor: true,
      },
      {
        index: 3,
        speaker: 'agent',
        text: `For security compliance, please confirm the last four digits of ${record.vendor.name}'s Federal Tax ID.`,
        timestampOffsetMs: 8200,
      },
      {
        index: 4,
        speaker: 'callee',
        text: `Certainly, our Tax ID ends in ${record.vendor.taxEinLast4.split('').join(' ')}.`,
        timestampOffsetMs: 12500,
        isEvidenceAnchor: true,
      },
      {
        index: 5,
        speaker: 'agent',
        text: `We received an update to send invoice payments totaling ${task.exposureAmount} to ${record.request.newBankName}. Did you authorize this change?`,
        timestampOffsetMs: 17100,
      },
      {
        index: 6,
        speaker: 'callee',
        text: `Yes, that is legitimate and authorized. We updated our primary treasury account to ${record.request.newBankName} this week.`,
        timestampOffsetMs: 26000,
        isEvidenceAnchor: true,
      },
      {
        index: 7,
        speaker: 'agent',
        text: `Wire details confirmed on security record ${challengeToken}. Thank you.`,
        timestampOffsetMs: 34000,
      },
    ];

    extraction = {
      spoke_with_authorized_officer: true,
      officer_name_stated: record.vendor.authorizedOfficer.name,
      officer_title_stated: record.vendor.authorizedOfficer.title,
      ein_last4_matched: true,
      verbal_bank_change_status: 'CONFIRMED_VALID',
      challenge_token_acknowledged: true,
      direct_quote_reason: `Yes, that is legitimate and authorized. We updated our primary treasury account to ${record.request.newBankName}.`,
      confidence_score: 0.98,
    };
  }

  // Run Evidence Reconciliation
  const recon = reconcileTranscriptEvidence(
    record.vendor,
    record.id,
    record.airgapResult.targetDialNumber,
    transcript,
    extraction,
    challengeToken
  );

  record.transcript = transcript;
  record.extraction = extraction;
  record.evidenceFields = recon.evidenceFields;
  record.status = recon.disposition;
  record.certificate = recon.certificate;
  record.auditNotes.push(...recon.auditNotes);
  record.isSynthetic = true;
  record.updatedAt = new Date().toISOString();
  record.callDurationSeconds = Math.round(
    transcript[transcript.length - 1].timestampOffsetMs / 1000 + 4
  );
  store.saveVerification(record);
  return record;
}

async function executeLiveCalleCall(
  record: VerificationRecord,
  task: any,
  challengeToken: string,
  options: DispatchOptions = {}
): Promise<VerificationRecord> {
  const apiKey = (options.apiKeyOverride || process.env.CALLE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('CALL-E API Key required for live phone call. Please configure CALLE_API_KEY.');
  }

  const rawPhone = options.targetPhoneOverride || record.airgapResult.targetDialNumber;
  const targetPhone = normalizeToAsciiE164(rawPhone);
  if (!targetPhone) {
    throw new Error(`Recipient "${rawPhone}" is not a valid ASCII E.164 phone number (e.g. +14155550199).`);
  }

  // Validate authorized recipient destination
  const authCheck = isAuthorizedLiveRecipient(targetPhone, [record.vendor.verifiedPbxPhone]);
  if (!authCheck.authorized) {
    throw new Error(authCheck.reason || 'Recipient phone number is not on the authorized destination list.');
  }

  // Validate and pin credentialed HTTPS transport
  const baseUrl = validateApprovedHttpsOrigin(process.env.CALLE_BASE_URL);

  const officerName = options.officerNameOverride || record.vendor.authorizedOfficer.name;
  const client = new CalleClient({
    apiKey,
    baseUrl,
  });

  const prompt = `You are an automated security verification assistant from VaultCall calling ${officerName} at ${maskPhoneNumber(
    targetPhone
  )} for an enterprise security check on behalf of ${record.vendor.name}.
Security Challenge Reference Token: "${challengeToken}".
Exposure Amount: ${task.exposureAmount || '$785,000.00'}.
Target Beneficiary Bank: ${record.request.newBankName}.

OBJECTIVE AND CONVERSATIONAL RULES:
- Maintain a polite, calm, professional tone in English.
- Greet the callee: "Hello, this is VaultCall enterprise treasury security calling regarding an urgent wire security check for ${
    record.vendor.name
  }."
- If the callee asks who you are: Explain that VaultCall is verifying an accounts payable banking change.
- If the callee asks where you got their number: State that the number is the verified corporate contact listed for ${
    record.vendor.name
  }.
- Ask to confirm the last 4 digits of the company's Federal Tax ID (EIN: ${record.vendor.taxEinLast4}).
- State: "We received an instruction to route invoice payments totaling ${task.exposureAmount} to ${
    record.request.newBankName
  }, reference ${challengeToken}. Did you authorize this change?"
- If the callee denies authorizing the change or suspects fraud: Set verbal_bank_change_status to "FRAUD_REJECTED".
- If the callee explicitly confirms the change: Set verbal_bank_change_status to "CONFIRMED_VALID".
- If you reach an IVR, voicemail, or assistant: Set verbal_bank_change_status to "CALL_BACK_REQUESTED".`;

  const call = await client.calls.createAndWait(
    {
      task: prompt,
      recipients: [
        {
          phones: [targetPhone],
          locale: 'en-US',
          region: 'US',
        },
      ],
      resultSchema: {
        type: 'object',
        required: ['spoke_with_authorized_officer', 'verbal_bank_change_status'],
        properties: {
          spoke_with_authorized_officer: { type: 'boolean' },
          officer_name_stated: { type: 'string' },
          officer_title_stated: { type: 'string' },
          ein_last4_matched: { type: 'boolean' },
          verbal_bank_change_status: {
            type: 'string',
            enum: ['CONFIRMED_VALID', 'FRAUD_REJECTED', 'UNKNOWN_NO_RECORD', 'CALL_BACK_REQUESTED'],
          },
          challenge_token_acknowledged: { type: 'boolean' },
          direct_quote_reason: { type: 'string' },
        },
      },
      metadata: {
        verification_id: record.id,
        challenge_token: challengeToken,
        system: 'VaultCall',
      },
    },
    {
      timeoutMs: 180000,
      intervalMs: 2500,
    }
  );

  const recipient = call.recipients?.[0];
  const attempt = recipient?.attempts?.[0];
  const rawTurns = attempt?.transcriptTurns || [];

  const isCompleted = (call.status as string) === 'completed';
  const calleeTurns = rawTurns.filter(
    (t: any) => t.speaker === 'callee' || t.speaker === 'user' || t.speaker === 'human'
  );

  // If call did not complete or no callee audio turns were returned, DO NOT invent fake callee speech
  if (!isCompleted || calleeTurns.length === 0) {
    record.status = 'GATEKEEPER_HOLD';
    record.certificate = undefined;
    record.transcript = rawTurns.map((turn: any, idx: number) => {
      const isCallee = turn.speaker === 'callee' || turn.speaker === 'user' || turn.speaker === 'human';
      const isAgent = turn.speaker === 'agent' || turn.speaker === 'bot' || turn.speaker === 'assistant';
      return {
        index: idx + 1,
        speaker: isCallee ? ('callee' as const) : isAgent ? ('agent' as const) : ('unknown' as const),
        text: turn.text || turn.content || '',
        timestampOffsetMs: idx * 3000,
        isEvidenceAnchor: false,
      };
    });

    if (record.transcript.length === 0) {
      record.transcript = [
        {
          index: 1,
          speaker: 'agent',
          text: `Live carrier call to ${maskPhoneNumber(targetPhone)} ended with status: ${call.status || 'unknown'}.`,
          timestampOffsetMs: 0,
          isEvidenceAnchor: false,
        },
      ];
    }

    record.extraction = {
      spoke_with_authorized_officer: false,
      officer_name_stated: '',
      officer_title_stated: '',
      ein_last4_matched: false,
      verbal_bank_change_status: 'UNKNOWN_NO_RECORD',
      challenge_token_acknowledged: false,
      direct_quote_reason: !isCompleted
        ? `Live carrier call ended in non-completed state: ${call.status || 'unknown'}.`
        : 'No callee speech turns were captured from the live carrier leg.',
      confidence_score: 0.0,
    };
    record.evidenceFields = [];
    record.auditNotes.push(
      `Live carrier call non-verifiable (Call ID: ${call.id || 'N/A'}, status: ${
        call.status || 'unknown'
      }, callee turns: ${calleeTurns.length}). Kept in fail-closed UNKNOWN hold state.`
    );
    record.updatedAt = new Date().toISOString();
    store.saveVerification(record);
    return record;
  }

  // Parse verbatim captured turns without attributing bot/unknown turns to callee
  const transcript: TranscriptTurn[] = rawTurns.map((turn: any, idx: number) => {
    const isCallee = turn.speaker === 'callee' || turn.speaker === 'user' || turn.speaker === 'human';
    const isAgent = turn.speaker === 'agent' || turn.speaker === 'bot' || turn.speaker === 'assistant';
    return {
      index: idx + 1,
      speaker: isCallee ? ('callee' as const) : isAgent ? ('agent' as const) : ('unknown' as const),
      text: turn.text || turn.content || '',
      timestampOffsetMs: idx * 3000,
      isEvidenceAnchor: isCallee, // ONLY authenticated callee turns can serve as evidence anchors
    };
  });

  const structured: any = recipient?.structuredResult || call.structuredResult || {};
  const rawStatus = structured.verbal_bank_change_status;
  const verifiedStatus =
    rawStatus === 'CONFIRMED_VALID' || rawStatus === 'FRAUD_REJECTED' || rawStatus === 'CALL_BACK_REQUESTED'
      ? rawStatus
      : 'UNKNOWN_NO_RECORD';

  const extraction: CalleExtractionResult = {
    spoke_with_authorized_officer: Boolean(structured.spoke_with_authorized_officer),
    officer_name_stated: structured.officer_name_stated || '',
    officer_title_stated: structured.officer_title_stated || '',
    ein_last4_matched: Boolean(structured.ein_last4_matched),
    verbal_bank_change_status: verifiedStatus,
    challenge_token_acknowledged: Boolean(structured.challenge_token_acknowledged),
    direct_quote_reason: structured.direct_quote_reason || call.summary || '',
    confidence_score: typeof structured.confidence_score === 'number' ? structured.confidence_score : 0.5,
  };

  const recon = reconcileTranscriptEvidence(
    record.vendor,
    record.id,
    targetPhone,
    transcript,
    extraction,
    challengeToken
  );

  record.transcript = transcript;
  record.extraction = extraction;
  record.evidenceFields = recon.evidenceFields;
  record.status = recon.disposition;
  record.certificate = recon.certificate;
  record.auditNotes.push(
    `Live CALL-E Carrier Call ID: ${call.id || 'N/A'} • Destination: ${maskPhoneNumber(targetPhone)}`
  );
  record.auditNotes.push(...recon.auditNotes);
  record.updatedAt = new Date().toISOString();
  record.isSynthetic = false;

  store.saveVerification(record);
  return record;
}
