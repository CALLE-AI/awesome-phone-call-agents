import axios from 'axios';
import { validateE164OrThrow } from '../utils/phoneValidation';
import { maskPhoneNumber, maskSensitiveCallPayload } from '../utils/piiMasking';
import {
  assertLiveCallDestinationAuthorized,
  isLiveCallsEnabled,
  validateCalleBaseUrl,
} from '../utils/liveCallGate';

type OutboundResult = {
  accepted: boolean;
  notes?: string | null;
  response_status: 'ACCEPTED' | 'DECLINED' | 'NO_ANSWER' | 'FAILED';
  calle_call_id?: string;
  raw?: any;
};

const asAccepted = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  const stringValue = String(value ?? '').trim().toLowerCase();
  return ['yes', 'accepted', 'true', 'accept'].includes(stringValue);
};

const isAmbiguousAccepted = (value: any): boolean => {
  const stringValue = String(value ?? '').trim().toLowerCase();
  return !['yes', 'accepted', 'true', 'accept', 'no', 'declined', 'false', 'decline'].includes(stringValue);
};

export default class CalleService {
  private client: any | undefined;
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor() {
    this.client = undefined;
    this.apiKey = process.env.CALLE_API_KEY;
    this.baseUrl = process.env.CALLE_BASE_URL || 'https://api.heycall-e.com';

    try {
      validateCalleBaseUrl();
    } catch (error: any) {
      console.error(error.message);
    }
  }

  private assertLiveRecipientsAuthorized(opts: any): void {
    const recipients = Array.isArray(opts?.recipients) ? opts.recipients : [];
    for (const recipient of recipients) {
      const phones = Array.isArray(recipient?.phones) ? recipient.phones : [];
      for (const phone of phones) {
        assertLiveCallDestinationAuthorized(phone);
      }
    }
  }

  private getHTTPClient(): any {
    return {
      calls: {
        createAndWait: async (opts: any, params?: any) => {
          if (!this.apiKey) throw new Error('No API key configured');
          if (!isLiveCallsEnabled()) {
            throw new Error('Live calls are disabled. Configure ALLOW_LIVE_CALLS, CALLE_API_KEY, CALLE_API_KEY_SOURCE, and ALLOWED_LIVE_RECIPIENTS.');
          }
          this.assertLiveRecipientsAuthorized(opts);

          const headers: any = {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          };

          if (params?.idempotencyKey) {
            headers['Idempotency-Key'] = params.idempotencyKey;
          }

          const createResponse = await axios.post(
            `${this.baseUrl}/v1/calls`,
            {
              task: opts.task,
              recipients: opts.recipients,
              metadata: maskSensitiveCallPayload(opts.metadata || {}),
            },
            { headers, timeout: 60000 }
          );

          const callId = createResponse.data.id || createResponse.data.call_id;
          if (!callId) {
            throw new Error('No call ID returned from CALL-E API');
          }

          const maxWaitMs = 360_000;
          const pollIntervalMs = 5_000;
          const startTime = Date.now();
          let callData: any = null;

          while (true) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            const getResponse = await axios.get(`${this.baseUrl}/v1/calls/${callId}`, { headers, timeout: 10000 });
            callData = getResponse.data;
            const status = (callData.status || '').toLowerCase();

            if (['completed', 'failed', 'no_answer', 'cancelled', 'canceled'].includes(status)) {
              break;
            }

            if (Date.now() - startTime > maxWaitMs) {
              break;
            }
          }

          if (!callData) {
            callData = createResponse.data;
          }

          return {
            id: callData.id || callData.call_id || `call-${Date.now()}`,
            status: callData.status || 'completed',
            summary: callData.summary || callData.message,
            structuredResult: callData.structuredResult || { accepted: callData.accepted },
            recipients: callData.recipients || [{ structuredResult: callData.structuredResult }],
            taskCompleted: callData.taskCompleted,
          };
        },
      },
    };
  }

  private getMockClient(): any {
    return {
      calls: {
        createAndWait: async (_opts: any, _params: any) => {
          await new Promise((resolve) => setTimeout(resolve, 350));
          const accepted = Math.random() > 0.5;
          return {
            id: `mock-${Date.now()}`,
            status: 'completed',
            summary: accepted ? 'Simulated patient accepted the earlier slot.' : 'Simulated patient declined or did not answer.',
            structuredResult: { accepted: accepted ? 'yes' : 'no' },
            recipients: [{ structuredResult: { accepted: accepted ? 'yes' : 'no' } }],
            metadata: { source: 'OpenSlot AI mock flow', target_phone: maskPhoneNumber(_opts?.recipients?.[0]?.phones?.[0] || '') },
          };
        },
      },
    };
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    if (!this.apiKey || !isLiveCallsEnabled()) {
      console.log('Using local mock CALL-E client for the reference demo flow.');
      this.client = this.getMockClient();
      return this.client;
    }

    try {
      const mod = await import('@call-e/calle');
      const CalleClient = mod.CalleClient;

      if (!CalleClient) {
        throw new Error('CalleClient not found in module');
      }

      this.client = new CalleClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
      return this.client;
    } catch (error: any) {
      console.warn('CALL-E SDK import failed, trying HTTP API fallback:', error.message);
      this.client = this.getHTTPClient();
      return this.client;
    }
  }

  async makeOutboundCall(phone: string, task: string): Promise<OutboundResult> {
    try {
      const validatedPhone = validateE164OrThrow(phone, 'Destination phone number');
      if (isLiveCallsEnabled()) {
        assertLiveCallDestinationAuthorized(validatedPhone);
      }
      return this.placeCallAndWaitForResult(validatedPhone, task);
    } catch (error: any) {
      return {
        accepted: false,
        response_status: 'FAILED',
        notes: error?.message || 'CALL-E outbound call failed',
      };
    }
  }

  async createReminderCall(phone: string, patientName: string, appointmentTime: Date, providerName: string): Promise<OutboundResult> {
    const reminderTask = `Call the authorized patient destination and speak to ${patientName}. This is a reminder from ${providerName}'s clinic. Tell them their appointment is scheduled for ${appointmentTime.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Ask them to confirm that they can make the visit. If they confirm, politely thank them and end the call. If they decline or do not answer, end politely and note that the clinic will follow up.`;

    return this.makeOutboundCall(phone, reminderTask);
  }

  async placeCallAndWaitForResult(phone: string, task: string, opts: { maxWaitMs?: number; pollIntervalMs?: number } = {}): Promise<OutboundResult> {
    let validatedPhone: string;
    try {
      validatedPhone = validateE164OrThrow(phone, 'Destination phone number');
      if (isLiveCallsEnabled()) {
        assertLiveCallDestinationAuthorized(validatedPhone);
      }
    } catch (error: any) {
      return {
        accepted: false,
        response_status: 'FAILED',
        notes: error.message,
      };
    }

    const maxWaitMs = opts.maxWaitMs ?? 120_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    const maskedPhone = maskPhoneNumber(validatedPhone);
    const client = await this.getClient();

    if (!client) {
      return { accepted: false, response_status: 'FAILED', notes: 'CALL-E client unavailable' };
    }

    const idemKey = `openslot-${Date.now()}-${validatedPhone.slice(-4)}`;
    let call: any;

    try {
      console.log(`Placing outbound call to ${maskedPhone}`);

      if (typeof client.calls?.createAndWait === 'function') {
        call = await client.calls.createAndWait(
          {
            task,
            recipients: [{ phones: [validatedPhone], region: 'IN', locale: 'en-IN' }],
            resultSchema: {
              type: 'object',
              required: ['accepted'],
              properties: { accepted: { type: 'string', enum: ['yes', 'no', 'unknown'] } },
            },
            metadata: { source: 'Clinic appointment backfill', target_phone: maskedPhone },
          },
          { idempotencyKey: idemKey }
        );
      } else if (typeof client.calls?.create === 'function') {
        const created = await client.calls.create(
          {
            task,
            recipients: [{ phones: [validatedPhone], region: 'IN', locale: 'en-IN' }],
            metadata: { source: 'Clinic appointment backfill', target_phone: maskedPhone },
          },
          { idempotencyKey: idemKey }
        );
        const callId = created?.id || created?.call_id;
        const started = Date.now();

        while (true) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          if (Date.now() - started > maxWaitMs) {
            return { accepted: false, response_status: 'NO_ANSWER', notes: 'Call timed out; no auto-advance to next patient', calle_call_id: callId };
          }
          const fetched = await client.calls.retrieve?.(callId);
          const status = (fetched?.status || '').toLowerCase();
          if (['completed', 'failed', 'no_answer', 'cancelled', 'canceled'].includes(status)) {
            call = fetched;
            break;
          }
        }
      } else {
        return { accepted: false, response_status: 'FAILED', notes: 'CALL-E client has no create/createAndWait method' };
      }
    } catch (error: any) {
      return { accepted: false, response_status: 'FAILED', notes: error?.message || 'CALL-E call failed', calle_call_id: error?.response?.data?.id };
    }

    const rawAccepted =
      call?.structuredResult?.accepted ??
      call?.recipients?.[0]?.structuredResult?.accepted ??
      call?.taskCompleted ??
      'unknown';

    if (isAmbiguousAccepted(rawAccepted)) {
      return {
        accepted: false,
        response_status: 'FAILED',
        notes: 'Ambiguous call result; manual review required before booking or rescheduling.',
        calle_call_id: call?.id,
        raw: maskSensitiveCallPayload(call),
      };
    }

    const accepted = asAccepted(rawAccepted);
    const status = (call?.status || '').toLowerCase();
    const response_status: OutboundResult['response_status'] =
      status === 'completed' ? (accepted ? 'ACCEPTED' : 'DECLINED')
      : status === 'failed' ? 'FAILED'
      : 'NO_ANSWER';

    console.log(`Call to ${maskedPhone}: ${response_status} (accepted: ${accepted})`);

    return {
      accepted,
      notes: call?.summary || call?.recipients?.[0]?.summary || 'Call completed',
      response_status,
      calle_call_id: call?.id,
      raw: maskSensitiveCallPayload(call),
    };
  }

  parseWebhook(body: any): OutboundResult {
    if (!body) return { accepted: false, response_status: 'FAILED' };
    const rawAccepted = body.accepted ?? body.structured_output?.accepted ?? body.structuredResult?.accepted;

    if (isAmbiguousAccepted(rawAccepted)) {
      return {
        accepted: false,
        notes: 'Ambiguous call result; manual review required before booking or rescheduling.',
        response_status: 'FAILED',
        calle_call_id: body.call_id || body.calle_call_id || body.id,
        raw: maskSensitiveCallPayload(body),
      };
    }

    const accepted = asAccepted(rawAccepted);
    const responseStatus = body.response_status || (accepted ? 'ACCEPTED' : 'DECLINED');

    return {
      accepted,
      notes: body.notes || body.summary || null,
      response_status: responseStatus,
      calle_call_id: body.call_id || body.calle_call_id || body.id,
      raw: maskSensitiveCallPayload(body),
    };
  }
}
