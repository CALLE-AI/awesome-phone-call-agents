import { CalleClient, CalleAuthenticationError, CalleRateLimitError, CalleAPIError } from '@call-e/calle';
import { PhoneAgentProvider } from './PhoneAgentProvider.js';
import { isDestinationAuthorized, maskPhoneNumber } from '../utils/phone.js';
import {
  CallRecord,
  CallState,
  CallTranscriptTurn,
  StructuredCallResult,
  VerificationTask,
  AvailabilityStatus,
  CallOutcome,
  VerificationConfidence,
} from '../types/index.js';

export class CallEProvider implements PhoneAgentProvider {
  private client: CalleClient | null = null;
  private apiKey: string | undefined;

  public getClient(): CalleClient | null {
    const key = process.env.CALLE_API_KEY || process.env.CALL_E_API_KEY;
    if (!key) return null;
    if (!this.client || this.apiKey !== key) {
      this.apiKey = key;
      try {
        this.client = new CalleClient({ apiKey: key });
      } catch (err) {
        console.error('Failed to initialize CalleClient:', err);
        return null;
      }
    }
    return this.client;
  }

  public isConfigured(): boolean {
    return Boolean(this.getClient());
  }

  private buildDynamicTaskPrompt(task: VerificationTask): string {
    const questionsPrompt = task.questions
      .map(
        (q, idx) =>
          `Question ${idx + 1} (${q.expectedType}): "${q.question}"${
            q.options ? ` [Allowed options: ${q.options.join(', ')}]` : ''
          }`
      )
      .join('\n');

    return [
      `You are TRACE, an autonomous professional verification agent calling on behalf of an operational supply-chain audit system.`,
      `Your goal is to verify the real-world operational status, inventory availability, lead time, or order status with the supplier.`,
      ``,
      `TARGET SUPPLIER / COMPANY: ${task.target.organizationName}`,
      task.target.contactPerson ? `TARGET CONTACT / DEPARTMENT: ${task.target.contactPerson}` : '',
      `VERIFICATION ITEM / RESOURCE: ${task.item}`,
      `VERIFICATION TYPE: ${task.verificationType}`,
      `SUBJECT: ${task.subject}`,
      `PRIMARY GOAL: ${task.verificationGoal}`,
      task.digitalClaim?.claimText ? `RECORDED DIGITAL CLAIM: "${task.digitalClaim.claimText}"` : '',
      ``,
      `REQUIRED VERIFICATION QUESTIONS TO ASK REPRESENTATIVE:`,
      questionsPrompt,
      ``,
      `CRITICAL OPERATIONAL RULES:`,
      `1. Be polite, concise, professional, and business-focused. Introduce yourself clearly as TRACE Verification.`,
      `2. Ask the specific verification questions listed above.`,
      `3. Confirm specific numbers, quantities, lead times, and dates whenever possible.`,
      `4. Do NOT assume, fabricate, or guess availability.`,
      `5. If the representative is unsure, vague, or says parts are unconfirmed, explicitly record the response as unconfirmed.`,
      `6. Pronounce and refer to alphanumeric part numbers, model codes, and product SKUs (such as ${task.item}) naturally as a unified part number (e.g. say '${task.item}', do not dictate 'capitalized S, capitalized T...').`,
      `7. Once all questions have been addressed, thank the representative politely and conclude the call.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildDynamicResultSchema(task: VerificationTask): Record<string, any> {
    const questionProperties: Record<string, any> = {};

    task.questions.forEach((q) => {
      let propSchema: any = { type: 'string', description: `Answer to: ${q.question}` };
      if (q.expectedType === 'boolean') {
        propSchema = { type: 'boolean', description: `True/False answer to: ${q.question}` };
      } else if (q.expectedType === 'number') {
        propSchema = { type: 'number', description: `Numeric value for: ${q.question}` };
      } else if (q.expectedType === 'choice' && q.options && q.options.length > 0) {
        propSchema = { type: 'string', enum: q.options, description: `Choice for: ${q.question}` };
      }

      questionProperties[q.id] = {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          question: { type: 'string' },
          expectedType: { type: 'string' },
          answer: propSchema,
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'Exact quote or phrase from staff member' },
        },
        required: ['questionId', 'question', 'answer', 'confidence'],
      };
    });

    return {
      type: 'object',
      properties: {
        call_outcome: {
          type: 'string',
          enum: ['confirmed', 'contradicted', 'partial', 'unknown', 'unreachable', 'no_answer', 'failed'],
          description: 'Overall verification outcome established during the conversation.',
        },
        verification_confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence rating based on directness and clarity of staff response.',
        },
        availability_status: {
          type: 'string',
          enum: ['available', 'unavailable', 'limited', 'unknown'],
          description: 'Physical or operational availability of the subject item/service.',
        },
        quantity_or_capacity: {
          type: ['string', 'null'],
          description: 'Exact quantity, seat count, capacity, or slot confirmed by staff, if applicable.',
        },
        next_available_time: {
          type: ['string', 'null'],
          description: 'Date or time slot confirmed by staff, if applicable.',
        },
        contact_name: {
          type: ['string', 'null'],
          description: 'Name or title of staff member who answered.',
        },
        notes: {
          type: 'string',
          description: 'Key contextual details, restrictions, or operational conditions stated by staff.',
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'Direct quotations from staff supporting the conclusion.',
        },
        question_answers: {
          type: 'object',
          properties: questionProperties,
        },
      },
      required: ['call_outcome', 'verification_confidence', 'availability_status', 'evidence'],
    };
  }

  async startVerificationCall(
    task: VerificationTask,
    idempotencyKey: string
  ): Promise<{ callId: string; initialRecord: CallRecord }> {
    const client = this.getClient();
    if (!client) {
      throw new Error(
        'CALLE_API_KEY is not configured on the server. Please provide a valid CALLE_API_KEY in your environment variables to place real outbound calls.'
      );
    }

    // Safety policy: check if destination is authorized for live calling
    const authCheck = isDestinationAuthorized(task.target.phoneNumber, 'LIVE');
    if (!authCheck.authorized) {
      const err = new Error(authCheck.reason || `Destination ${maskPhoneNumber(task.target.phoneNumber)} is not authorized for live outbound calls.`);
      (err as any).isDefinitiveRejection = true;
      throw err;
    }

    const taskPrompt = this.buildDynamicTaskPrompt(task);
    const resultSchema = this.buildDynamicResultSchema(task);

    const webhookUrl = process.env.CALLE_WEBHOOK_URL || undefined;

    try {
      // Direct CALL-E API call with exact validated user phone number
      const call = await client.calls.create(
        {
          task: taskPrompt,
          recipients: [
            {
              phone: authCheck.formatted,
              phones: [authCheck.formatted],
              region: authCheck.formatted.startsWith('+91') ? 'IN' : undefined,
            },
          ],
          metadata: {
            taskId: task.id,
            organizationName: task.target.organizationName,
            subject: task.subject,
            system: 'TRACE_VERIFICATION_ENGINE',
          },
          webhookUrl,
        },
        {
          idempotencyKey,
        }
      );

      const record: CallRecord = {
        id: `call_${task.id}`,
        taskId: task.id,
        providerCallId: call.id,
        idempotencyKey,
        phoneNumber: authCheck.formatted,
        mode: 'LIVE',
        callState: this.mapCallEStatusToCallState(call.status),
        startedAt: call.createdAt || new Date().toISOString(),
        durationSeconds: 0,
        transcriptTurns: [], // Zero synthetic turns in LIVE mode
        structuredResult: null,
      };

      return { callId: call.id, initialRecord: record };
    } catch (err: any) {
      console.error('CALL-E API call creation error:', err?.message || err);
      const isDefinitiveRejection =
        Boolean(err.isDefinitiveRejection) ||
        err instanceof CalleAuthenticationError ||
        err?.status === 401 ||
        err?.status === 403 ||
        err?.status === 422 ||
        err?.status === 400;

      const maskedNum = maskPhoneNumber(task.target.phoneNumber);
      let errorMsg: string;

      if (err instanceof CalleAuthenticationError || err?.status === 401 || err?.status === 403) {
        errorMsg = 'CALL-E authentication failed (401/403). Please verify your CALLE_API_KEY.';
      } else if (err?.status === 422) {
        errorMsg = `CALL-E rejected the request parameters (422). Please verify phone number format: ${maskedNum}`;
      } else if (err instanceof CalleRateLimitError || err?.status === 429) {
        errorMsg = 'CALL-E API rate limit reached (429). Please retry shortly.';
      } else if (err instanceof CalleAPIError) {
        errorMsg = `CALL-E API error (${err.status}): ${err.message}`;
      } else {
        errorMsg = err.message || 'Failed to initiate real CALL-E phone call';
      }

      const wrappedErr = new Error(errorMsg);
      (wrappedErr as any).isDefinitiveRejection = isDefinitiveRejection;
      (wrappedErr as any).isAmbiguous = !isDefinitiveRejection;
      throw wrappedErr;
    }
  }

  async getCallProgress(callId: string, task: VerificationTask): Promise<CallRecord> {
    const client = this.getClient();
    if (!client) {
      throw new Error('CALLE_API_KEY is not configured on the server.');
    }

    try {
      const call = await client.calls.get(callId);
      const recipient = call.recipients?.[0];
      const attempt = recipient?.attempts?.[0];

      let rawStatus = call.status;
      if (
        recipient?.status === 'in_progress' ||
        attempt?.status === 'in_progress'
      ) {
        if ((rawStatus as string) === 'queued' || (rawStatus as string) === 'pending') {
          rawStatus = 'in_progress';
        }
      }
      if (recipient?.status === 'completed' || attempt?.status === 'completed' || (call as any).taskCompleted) {
        rawStatus = 'completed';
      }
      if (recipient?.status === 'failed' || attempt?.status === 'failed') {
        rawStatus = 'failed';
      }

      const callState = this.mapCallEStatusToCallState(rawStatus);

      // Extract real transcript turns from recipient attempts
      const transcriptTurns: CallTranscriptTurn[] = [];

      if (attempt?.transcriptTurns && Array.isArray(attempt.transcriptTurns)) {
        attempt.transcriptTurns.forEach((turn: any, index: number) => {
          const rawRole = (
            turn.role ||
            turn.speaker ||
            turn.from ||
            turn.type ||
            turn.direction ||
            ''
          ).toLowerCase();

          let speaker: 'AI' | 'STAFF' | 'UNKNOWN' = 'UNKNOWN';
          if (
            rawRole.includes('agent') ||
            rawRole.includes('assistant') ||
            rawRole.includes('ai') ||
            rawRole.includes('bot') ||
            rawRole.includes('caller') ||
            rawRole.includes('trace') ||
            rawRole.includes('system')
          ) {
            speaker = 'AI';
          } else if (
            rawRole.includes('user') ||
            rawRole.includes('callee') ||
            rawRole.includes('staff') ||
            rawRole.includes('human') ||
            rawRole.includes('recipient') ||
            rawRole.includes('customer')
          ) {
            speaker = 'STAFF';
          } else {
            // Conversational text heuristic: only classify as AI if matching unmistakable AI agent patterns
            const textLower = (turn.text || '').toLowerCase();
            if (
              textLower.includes('i am calling from trace') ||
              textLower.startsWith('hello, this is trace') ||
              textLower.startsWith('hi, i am calling') ||
              textLower.includes('trace verification') ||
              textLower.includes('please verify the physical stock') ||
              textLower.includes('our digital system shows')
            ) {
              speaker = 'AI';
            } else {
              // Unrecognized speaker remains strictly UNKNOWN (do not guess STAFF)
              speaker = 'UNKNOWN';
            }
          }

          const offsetSec = turn.offsetSeconds ?? turn.offset_seconds ?? index * 5;
          const mins = String(Math.floor(offsetSec / 60)).padStart(2, '0');
          const secs = String(offsetSec % 60).padStart(2, '0');

          transcriptTurns.push({
            id: `turn_${turn.id || index}`,
            timestamp: `${mins}:${secs}`,
            speaker,
            text: turn.text || '',
          });
        });
      }

      // Extract structured result returned by CALL-E
      const rawResult = call.structuredResult || recipient?.structuredResult || null;
      let structuredResult: StructuredCallResult | null = null;

      if (rawResult && typeof rawResult === 'object') {
        const answersMap: Record<string, any> = {};
        if (rawResult.question_answers && typeof rawResult.question_answers === 'object') {
          Object.entries(rawResult.question_answers).forEach(([key, val]: [string, any]) => {
            answersMap[key] = {
              questionId: val.questionId || key,
              question: val.question || '',
              expectedType: val.expectedType || 'text',
              answer: val.answer ?? null,
              confidence: val.confidence || 'medium',
              evidence: val.evidence || undefined,
            };
          });
        }

        structuredResult = {
          call_outcome: (rawResult.call_outcome as CallOutcome) || 'unknown',
          verification_confidence:
            (rawResult.verification_confidence as VerificationConfidence) ||
            (typeof (call as any).completionConfidence === 'string'
              ? (call as any).completionConfidence.toLowerCase()
              : (call as any)?.completionConfidence?.label?.toLowerCase() || 'medium'),
          availability_status: (rawResult.availability_status as AvailabilityStatus) || 'unknown',
          quantity_or_capacity: (rawResult.quantity_or_capacity as string) || null,
          next_available_time: (rawResult.next_available_time as string) || null,
          contact_name: (rawResult.contact_name as string) || null,
          notes: (rawResult.notes as string) || call.summary || '',
          evidence: Array.isArray(rawResult.evidence) ? rawResult.evidence : call.evidence || [],
          question_answers: answersMap,
          raw_response: rawResult,
        };
      }

      // If call is completed but structuredResult wasn't returned by API, parse STRICTLY from staff transcript
      if (!structuredResult && callState === 'COMPLETED') {
        const staffTurns = transcriptTurns.filter((t) => t.speaker === 'STAFF');
        const staffSpeech = staffTurns.map((t) => t.text).join(' ');
        const staffLower = staffSpeech.toLowerCase();

        if (staffTurns.length === 0) {
          const answersMap: Record<string, any> = {};
          task.questions.forEach((q) => {
            answersMap[q.id] = {
              questionId: q.id,
              question: q.question,
              expectedType: q.expectedType,
              answer: null,
              confidence: 'low',
              evidence: undefined,
            };
          });

          structuredResult = {
            call_outcome: 'unknown',
            verification_confidence: 'low',
            availability_status: 'unknown',
            quantity_or_capacity: null,
            next_available_time: null,
            contact_name: null,
            notes: 'No verified staff responses were identified in conversation transcript; status is advisory and unverified.',
            evidence: transcriptTurns.map((t) => `[${t.speaker}] ${t.text}`).slice(0, 3),
            question_answers: answersMap,
            raw_response: call,
          };
        } else {
          // 1. Explicitly check for inability to verify / hotline / no inventory info
          const isUnverifiable =
            staffLower.includes("don't have inventory") ||
            staffLower.includes('no inventory') ||
            staffLower.includes("can't verify") ||
            staffLower.includes('cannot verify') ||
            staffLower.includes('unable to verify') ||
            staffLower.includes('test hotline') ||
            staffLower.includes('hotline') ||
            staffLower.includes('wrong number') ||
            staffLower.includes('wrong department') ||
            staffLower.includes("don't know") ||
            staffLower.includes('no information') ||
            staffLower.includes('not able to check') ||
            staffLower.includes('call back later');

          // 2. Explicitly check for unavailable / out of stock
          const isUnavailable =
            !isUnverifiable &&
            (staffLower.includes('out of stock') ||
              staffLower.includes('zero stock') ||
              staffLower.includes('0 units') ||
              staffLower.includes('none available') ||
              staffLower.includes('sold out') ||
              staffLower.includes('unavailable') ||
              staffLower.includes('not available') ||
              staffLower.includes('no stock') ||
              staffLower.includes('closed'));

          // 3. Check for restricted / conditional availability
          const isRestricted =
            !isUnverifiable &&
            !isUnavailable &&
            (staffLower.includes('deposit') ||
              staffLower.includes('minimum') ||
              staffLower.includes('conditional') ||
              staffLower.includes('limited') ||
              staffLower.includes('hold'));

          // 4. Check for positive availability stated by staff
          const isAvailable =
            !isUnverifiable &&
            !isUnavailable &&
            !isRestricted &&
            (staffLower.includes('in stock') ||
              staffLower.includes('ready to ship') ||
              staffLower.includes('yes we have') ||
              staffLower.includes('we have') ||
              staffLower.includes('we can ship') ||
              staffLower.includes('available'));

          const availability_status: AvailabilityStatus = isUnverifiable
            ? 'unknown'
            : isUnavailable
            ? 'unavailable'
            : isRestricted
            ? 'limited'
            : isAvailable
            ? 'available'
            : 'unknown';

          const call_outcome: CallOutcome =
            availability_status === 'available'
              ? 'confirmed'
              : availability_status === 'unavailable'
              ? 'contradicted'
              : availability_status === 'limited'
              ? 'partial'
              : 'unknown';

          const confidence: VerificationConfidence = isUnverifiable
            ? 'low'
            : isAvailable || isUnavailable
            ? 'high'
            : 'medium';

          // Extract numbers stated specifically by staff (e.g. "we have 320 units")
          let staffQuantity: string | null = null;
          if (isUnavailable) {
            staffQuantity = '0';
          } else if (isAvailable || isRestricted) {
            const qtyMatch = staffSpeech.match(/(\d+[\d,\.]*)\s*(units|pcs|pieces|items|boxes|kg)?/i);
            if (qtyMatch) {
              staffQuantity = `${qtyMatch[1]}${qtyMatch[2] ? ` ${qtyMatch[2]}` : ' units'}`;
            }
          }

          const answersMap: Record<string, any> = {};
          task.questions.forEach((q) => {
            let ans: any = isUnverifiable
              ? 'Unverifiable / No inventory info provided by representative'
              : isAvailable
              ? (staffQuantity ? `${staffQuantity} available` : 'Confirmed available with representative')
              : isUnavailable
              ? 'Unavailable / Out of stock'
              : 'Unknown';

            if (q.expectedType === 'boolean') {
              ans = isUnverifiable ? null : isAvailable ? true : isUnavailable ? false : null;
            } else if (q.expectedType === 'number' && staffQuantity) {
              const num = parseFloat(staffQuantity.replace(/,/g, ''));
              if (!isNaN(num)) ans = num;
            }

            answersMap[q.id] = {
              questionId: q.id,
              question: q.question,
              expectedType: q.expectedType,
              answer: ans,
              confidence,
              evidence: staffTurns[0]?.text || undefined,
            };
          });

          structuredResult = {
            call_outcome,
            verification_confidence: confidence,
            availability_status,
            quantity_or_capacity: staffQuantity,
            next_available_time: null,
            contact_name: task.target.contactPerson || 'Staff',
            notes: isUnverifiable
              ? 'Supplier explicitly stated they do not have inventory information and cannot verify physical stock.'
              : isUnavailable
              ? 'Supplier confirmed physical stock is unavailable / out of stock.'
              : isAvailable
              ? 'Supplier confirmed physical stock availability.'
              : 'Call completed, but representative could not confirm physical availability.',
            evidence:
              staffTurns.length > 0
                ? staffTurns.map((t) => t.text).slice(0, 3)
                : [call.summary || 'Call completed with representative.'],
            question_answers: answersMap,
            raw_response: call,
          };
        }
      }

      // Safeguard: sanitize structuredResult against transcript and call summary to eliminate false positive confirmations
      if (structuredResult) {
        const staffSpeech = transcriptTurns
          .filter((t) => t.speaker === 'STAFF')
          .map((t) => t.text.toLowerCase())
          .join(' ');
        
        const summaryLower = (call.summary || '').toLowerCase();
        const evidenceStr = Array.isArray(call.evidence) ? call.evidence.join(' ').toLowerCase() : '';
        const allContext = `${staffSpeech} ${summaryLower} ${evidenceStr}`;

        const isUnverifiableStaff =
          allContext.includes("don't have inventory") ||
          allContext.includes('no inventory') ||
          allContext.includes("can't verify") ||
          allContext.includes('cannot verify') ||
          allContext.includes('could not be verified') ||
          allContext.includes('unable to verify') ||
          allContext.includes('test hotline') ||
          allContext.includes('hotline') ||
          allContext.includes('not a warehouse') ||
          allContext.includes('no warehouse representative') ||
          allContext.includes('wrong number') ||
          allContext.includes('wrong department') ||
          allContext.includes("don't know") ||
          allContext.includes('no information') ||
          allContext.includes('not able to check');

        if (isUnverifiableStaff) {
          structuredResult.call_outcome = 'unknown';
          structuredResult.availability_status = 'unknown';
          structuredResult.verification_confidence = 'low';
          structuredResult.quantity_or_capacity = null;
          structuredResult.notes =
            'Call reached a test hotline or representative could not verify physical inventory.';
        }
      }

      const startedAt = attempt?.startedAt || call.createdAt || new Date().toISOString();
      const completedAt = call.completedAt || attempt?.completedAt || (callState === 'COMPLETED' ? new Date().toISOString() : undefined);
      
      const durationSeconds =
        completedAt && startedAt
          ? Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000))
          : 0;

      return {
        id: `call_${task.id}`,
        taskId: task.id,
        providerCallId: call.id,
        idempotencyKey: (call.metadata?.idempotencyKey as string) || `key_${task.id}`,
        phoneNumber: task.target.phoneNumber,
        mode: 'LIVE',
        callState,
        startedAt,
        completedAt,
        durationSeconds,
        transcriptTurns,
        structuredResult,
        error: call.failureMessage || undefined,
      };
    } catch (err: any) {
      console.error(`Error fetching CALL-E call status for ${callId}:`, err);
      throw new Error(`Failed to fetch CALL-E call progress: ${err.message || String(err)}`);
    }
  }

  private mapCallEStatusToCallState(status: string | undefined): CallState {
    if (!status) return 'UNKNOWN';
    const s = status.toLowerCase();
    if (s === 'queued' || s === 'pending') return 'QUEUED';
    if (s === 'in_progress' || s === 'active' || s === 'ringing') return 'IN_PROGRESS';
    if (s === 'completed' || s === 'succeeded' || s === 'success') return 'COMPLETED';
    if (s === 'failed' || s === 'error') return 'FAILED';
    if (s === 'canceled' || s === 'cancelled') return 'CANCELED';
    return 'UNKNOWN';
  }
}
