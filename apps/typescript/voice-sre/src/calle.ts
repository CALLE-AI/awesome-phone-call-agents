import { CalleClient } from '@call-e/calle';
import { Incident, VoiceSREResult, ActionDecision } from './types.js';
import { maskPhoneNumber, validateE164Phone } from './config.js';

export interface DispatchCallParams {
  apiKey: string;
  phoneNumber: string;
  mode: 'preview' | 'live';
  incident: Incident;
}

export interface DispatchCallResult {
  mode: 'preview' | 'live';
  callId: string;
  status: string;
  maskedRecipient: string;
  result: VoiceSREResult;
  logs: string[];
}

export async function dispatchVoiceSRECall(params: DispatchCallParams): Promise<DispatchCallResult> {
  const { apiKey, phoneNumber, mode, incident } = params;
  const executionLogs: string[] = [];

  // 1. Strict Phone Validation (Security & Anti-Abuse)
  if (!validateE164Phone(phoneNumber)) {
    throw new Error(`Refusing to dial: Phone number '${phoneNumber}' is not strict E.164.`);
  }

  const maskedPhone = maskPhoneNumber(phoneNumber);
  executionLogs.push(`[VALIDATION] Target recipient verified: ${maskedPhone}`);

  // 2. Structured Task Prompt with MANDATORY AI Disclosure
  const taskPrompt = `
You are VoiceSRE, an autonomous Site Reliability Engineering voice assistant.
Immediately disclose that you are an AI assistant calling on behalf of the DevOps On-Call Alert System.
Inform the engineer:
- Incident: ${incident.severity} on ${incident.service}.
- Error: HTTP 500 error rate spiked to ${incident.errorRate}% following release ${incident.lastCommit.hash} by ${incident.lastCommit.author}.
- Root Cause: ${incident.rootCause}.

Ask the engineer for immediate action:
1. Roll back deployment to stable version v2.4.0 (Recommended).
2. Restart pods.
3. Scale up pods.
4. Acknowledge only and investigate manually.

Listen carefully to the engineer's verbal decision, confirm their order, and record their exact instructions.
`.trim();

  // Mask phone numbers from any debug prompts
  const maskedTaskPrompt = taskPrompt.replace(phoneNumber, maskedPhone);

  // 3. Dry-Run / Preview Mode Gate (Default Safe Operation)
  if (mode !== 'live' || !apiKey || apiKey.startsWith('mock_')) {
    executionLogs.push(`[PREVIEW MODE] No live phone call placed. (Safe simulation)`);
    executionLogs.push(`[PREVIEW] Would dial: ${maskedPhone}`);
    executionLogs.push(`[TASK PROMPT PREVIEW]:\n${maskedTaskPrompt}`);

    // Realistic simulated decision for preview mode
    const simulatedResult: VoiceSREResult = {
      action_decision: 'rollback',
      target_service: incident.service,
      target_version: 'v2.4.0',
      engineer_notes: 'Engineer approved rollback to v2.4.0 and cache flush via voice command.'
    };

    executionLogs.push(`[SIMULATION] Captured verbal decision: ${simulatedResult.action_decision.toUpperCase()}`);

    return {
      mode: 'preview',
      callId: `call-prev-${Date.now()}`,
      status: 'simulated_completed',
      maskedRecipient: maskedPhone,
      result: simulatedResult,
      logs: executionLogs
    };
  }

  // 4. Live Call Execution via CALL-E SDK
  executionLogs.push(`[LIVE DISPATCH] Placing live CALL-E phone call to ${maskedPhone}...`);
  const client = new CalleClient({ apiKey });

  const call = await client.calls.createAndWait(
    {
      task: taskPrompt,
      recipients: [{ phones: [phoneNumber], locale: 'en-US' }],
      resultSchema: {
        type: 'object',
        required: ['action_decision', 'engineer_notes'],
        properties: {
          action_decision: {
            type: 'string',
            enum: ['rollback', 'restart', 'scale_up', 'acknowledge_only', 'unknown']
          },
          target_service: { type: 'string' },
          target_version: { type: 'string' },
          engineer_notes: { type: 'string', description: 'Brief summary of engineer response.' }
        },
        additionalProperties: false
      }
    },
    {
      idempotencyKey: `voicesre-${incident.id}-${Date.now()}`
    }
  );

  executionLogs.push(`[CALL-E] Call completed with status: ${call.status}`);

  const structured = (call.structuredResult as any) || {};
  const finalDecision: ActionDecision =
    structured.action_decision && structured.action_decision !== 'unknown'
      ? (structured.action_decision as ActionDecision)
      : 'acknowledge_only';

  const result: VoiceSREResult = {
    action_decision: finalDecision,
    target_service: structured.target_service || incident.service,
    target_version: structured.target_version || 'v2.4.0',
    engineer_notes: structured.engineer_notes || 'Call completed without additional notes.'
  };

  return {
    mode: 'live',
    callId: call.id || `call-${Date.now()}`,
    status: call.status,
    maskedRecipient: maskedPhone,
    result,
    logs: executionLogs
  };
}
