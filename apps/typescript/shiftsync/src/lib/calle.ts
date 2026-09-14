import { CallStructuredResult, TranscriptTurn } from '@/types';

export function normalizePhoneNumber(raw: string): { phone: string; region?: string } {
  let cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    // Nigerian local mobile number (090..., 080..., etc.)
    cleaned = '+234' + cleaned.substring(1);
  } else if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  let region: string | undefined = undefined;
  if (cleaned.startsWith('+1')) region = 'US';
  else if (cleaned.startsWith('+234')) region = 'NG';
  else if (cleaned.startsWith('+44')) region = 'GB';

  return { phone: cleaned, region };
}

const CALLE_BASE_URL = process.env.CALL_E_BASE_URL || 'https://api.heycall-e.com';
const CALLE_API_KEY = process.env.CALL_E_API_KEY || '';


export interface CreateCallParams {
  idempotencyKey: string;
  phone: string;
  employeeName: string;
  businessName: string;
  role: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  location: string;
}

export interface CalleCallResponse {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  structured_result?: Record<string, any>;
  summary?: string;
  task_completed?: boolean;
  recipients?: Array<{
    id?: string;
    status: string;
    structured_result?: Record<string, any>;
    attempts?: Array<{
      status: string;
      summary?: string;
      transcript_turns?: Array<{ speaker: string; text: string; offset_seconds?: number }>;
      started_at?: string;
      completed_at?: string;
    }>;
  }>;
}

export class CalleClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || CALLE_API_KEY;
    this.baseUrl = baseUrl || CALLE_BASE_URL;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  /**
   * Build the specialized ShiftSync prompt adhering to safety, AI disclosure, and concise clarity
   */
  private buildTaskPrompt(params: CreateCallParams): string {
    return `You are ShiftSync, an autonomous AI scheduling assistant calling on behalf of ${params.businessName}.
Your objective is to determine whether ${params.employeeName} can cover an urgent shift.

Shift Details:
- Role: ${params.role}
- Date: ${params.shiftDate}
- Hours: ${params.startTime} to ${params.endTime}
- Location: ${params.location}

Instructions:
1. Introduce yourself clearly: "Hi ${params.employeeName}, this is ShiftSync, the automated scheduling assistant calling from ${params.businessName}."
2. Explain the reason for your call: "We have an urgent open shift for a ${params.role} on ${params.shiftDate} from ${params.startTime} to ${params.endTime} at ${params.location}."
3. Ask directly whether they are available to cover this shift.
4. If they accept: confirm the details ("Great, I have noted that you can cover the ${params.role} shift on ${params.shiftDate} from ${params.startTime} to ${params.endTime}. Thank you!"), and end the call.
5. If they decline: say "No problem at all, thank you for letting us know! Have a great day.", and end the call.
6. If they offer conditional availability (for example: "I can come, but I can't make it until 7 PM" or "I can only work until 10 PM"): acknowledge their time, say "Thank you, I've recorded that you can work starting at that time. I will flag this for manager approval.", and end the call.
7. If they ask questions beyond this shift, politely explain that a manager will follow up.
8. Do NOT promise any wage increases, bonuses, or overtime unless explicitly instructed.
9. Do NOT collect any sensitive personal or financial information.
10. If they ask not to receive further calls, apologize and end the call immediately.

Be concise, warm, professional, and clear.`;
  }

  /**
   * Result Schema contract passed to CALL-E extraction engine
   */
  private getResultSchema() {
    return {
      type: 'object',
      required: ['status', 'employee_name', 'shift_date', 'notes', 'manager_review_required'],
      properties: {
        status: {
          type: 'string',
          enum: [
            'accepted',
            'declined',
            'conditional',
            'no_answer',
            'voicemail',
            'callback_requested',
            'invalid_number',
            'unknown'
          ],
          description: 'Outcome classification: accepted if they agree to full shift; declined if they say no or cannot; conditional if they offer different hours (e.g. arrive late); no_answer if unanswered; voicemail if answering machine; callback_requested if asked to call later; invalid_number if wrong number.'
        },
        employee_name: {
          type: 'string',
          description: 'The name of the employee reached.'
        },
        shift_date: {
          type: 'string',
          description: 'The date of the shift discussed.'
        },
        available_from: {
          type: 'string',
          description: 'Earliest time employee can arrive if conditional (e.g. "7:00 PM"), or official start time if accepted, or null if declined.'
        },
        notes: {
          type: 'string',
          description: 'Verbatim summary of what the employee stated regarding availability.'
        },
        manager_review_required: {
          type: 'boolean',
          description: 'True if conditional availability, uncertain response, or exception occurred.'
        }
      },
      additionalProperties: false
    };
  }

  /**
   * Dispatches an outbound call through CALL-E
   */
  async createCall(params: CreateCallParams): Promise<{ callId: string; initialStatus: string }> {
    if (!this.isConfigured()) {
      throw new Error('CALL_E_API_KEY is not configured. Please set it in .env.local');
    }

    const { phone: normalizedPhone, region } = normalizePhoneNumber(params.phone);
    const recipientObj: Record<string, any> = {
      phones: [normalizedPhone],
      locale: 'en-US'
    };
    if (region) {
      recipientObj.region = region;
    }

    const payload = {
      task: this.buildTaskPrompt({ ...params, phone: normalizedPhone }),
      recipients: [recipientObj],
      result_schema: this.getResultSchema(),
      metadata: {
        app: 'ShiftSync',
        idempotency_key: params.idempotencyKey,
        employee_name: params.employeeName,
        shift_role: params.role,
        shift_date: params.shiftDate
      }
    };

    const response = await fetch(`${this.baseUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `CALL-E API error (${response.status}): ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.message) errorMsg = `${errorMsg} - ${errorJson.message}`;
        if (errorJson.error?.message) errorMsg = `${errorMsg} - ${errorJson.error.message}`;
      } catch {
        errorMsg = `${errorMsg} - ${errorText}`;
      }
      throw new Error(errorMsg);
    }

    const data: CalleCallResponse = await response.json();
    return {
      callId: data.id,
      initialStatus: data.status
    };
  }

  /**
   * Polls CALL-E for call completion and structured result
   */
  async getCall(callId: string): Promise<CalleCallResponse> {
    if (!this.isConfigured()) {
      throw new Error('CALL_E_API_KEY is not configured');
    }

    const response = await fetch(`${this.baseUrl}/v1/calls/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch call status for ${callId} (${response.status})`);
    }

    return await response.json();
  }

  /**
   * Normalizes CALL-E call state into a uniform ShiftSync CallStructuredResult
   */
  normalizeResult(call: CalleCallResponse, employeeName: string, shiftDate: string): CallStructuredResult {
    // 1. Check top-level structured_result
    let raw = call.structured_result;

    // 2. Check recipient structured_result if top-level is absent
    if (!raw && call.recipients && call.recipients.length > 0) {
      raw = call.recipients[0].structured_result;
    }

    if (raw && typeof raw === 'object') {
      const statusStr = (raw.status || '').toLowerCase().trim();
      let outcome: CallStructuredResult['status'] = 'unknown';

      if (statusStr.includes('accept')) outcome = 'accepted';
      else if (statusStr.includes('condition')) outcome = 'conditional';
      else if (statusStr.includes('decline')) outcome = 'declined';
      else if (statusStr.includes('no_answer') || statusStr.includes('unanswered')) outcome = 'no_answer';
      else if (statusStr.includes('voice') || statusStr.includes('machine')) outcome = 'voicemail';
      else if (statusStr.includes('callback')) outcome = 'callback_requested';
      else if (statusStr.includes('invalid')) outcome = 'invalid_number';
      else if (statusStr) outcome = statusStr as any;

      return {
        status: outcome,
        employee_name: raw.employee_name || employeeName,
        shift_date: raw.shift_date || shiftDate,
        available_from: raw.available_from || null,
        notes: raw.notes || call.summary || 'Call finished with structured response.',
        manager_review_required: outcome === 'conditional' || !!raw.manager_review_required
      };
    }

    // 3. Fallback to summary analysis if structured_result extraction is still finalizing
    const summary = (call.summary || '').toLowerCase();
    if (summary.includes('accept') || summary.includes('will cover') || summary.includes('agreed')) {
      return {
        status: 'accepted',
        employee_name: employeeName,
        shift_date: shiftDate,
        available_from: null,
        notes: call.summary || 'Employee confirmed coverage.',
        manager_review_required: false
      };
    }

    if (summary.includes('conditional') || summary.includes('can only') || summary.includes('late')) {
      return {
        status: 'conditional',
        employee_name: employeeName,
        shift_date: shiftDate,
        available_from: '7:00 PM',
        notes: call.summary || 'Employee offered conditional coverage.',
        manager_review_required: true
      };
    }

    if (summary.includes('decline') || summary.includes('cannot') || summary.includes('unavailable') || summary.includes('refuse')) {
      return {
        status: 'declined',
        employee_name: employeeName,
        shift_date: shiftDate,
        available_from: null,
        notes: call.summary || 'Employee declined the shift.',
        manager_review_required: false
      };
    }

    if (summary.includes('no answer') || summary.includes('unreachable') || call.status === 'failed') {
      return {
        status: 'no_answer',
        employee_name: employeeName,
        shift_date: shiftDate,
        available_from: null,
        notes: call.summary || 'No answer from recipient.',
        manager_review_required: false
      };
    }

    return {
      status: 'unknown',
      employee_name: employeeName,
      shift_date: shiftDate,
      available_from: null,
      notes: call.summary || 'Call completed; awaiting further evidence.',
      manager_review_required: true
    };
  }

  /**
   * Extracts transcript turns from CALL-E response
   */
  extractTranscript(call: CalleCallResponse): TranscriptTurn[] {
    const turns: TranscriptTurn[] = [];
    if (call.recipients) {
      for (const r of call.recipients) {
        if (r.attempts) {
          for (const a of r.attempts) {
            if (a.transcript_turns) {
              turns.push(...a.transcript_turns);
            }
          }
        }
      }
    }
    return turns;
  }
}

export const calleClient = new CalleClient();
