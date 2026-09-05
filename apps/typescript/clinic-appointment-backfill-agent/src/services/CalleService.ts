import axios from 'axios';

type OutboundResult = {
  accepted: boolean;
  notes?: string;
  response_status: 'ACCEPTED' | 'DECLINED' | 'NO_ANSWER' | 'FAILED';
  calle_call_id?: string;
  raw?: any;
};

const asAccepted = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  const stringValue = String(value ?? '').trim().toLowerCase();
  return ['yes', 'accepted', 'true', 'accept'].includes(stringValue);
};

export default class CalleService {
  private client: any | undefined;
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor() {
    this.client = undefined;
    this.apiKey = process.env.CALLE_API_KEY;
    this.baseUrl = process.env.CALLE_BASE_URL || 'https://api.heycall-e.com';
  }

  private getHTTPClient(): any {
    return {
      calls: {
        createAndWait: async (opts: any, params?: any) => {
          if (!this.apiKey) throw new Error('No API key configured');
          
          try {
            console.log(`📞 Calling CALL-E API: POST ${this.baseUrl}/v1/calls`);
            console.log(`   Auth: API key format: ${this.apiKey?.substring(0, 10)}...`);
            
            // Try with Bearer token first
            const headers: any = {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            };
            
            if (params?.idempotencyKey) {
              headers['Idempotency-Key'] = params.idempotencyKey;
            }
            
            // Step 1: Create the call
            const createResponse = await axios.post(
              `${this.baseUrl}/v1/calls`,
              {
                task: opts.task,
                recipients: opts.recipients,
                // Note: resultSchema is removed - CALL-E API v1 doesn't accept it
                metadata: opts.metadata || {},
              },
              {
                headers,
                timeout: 60000,
              }
            );
            
            const callId = createResponse.data.id || createResponse.data.call_id;
            if (!callId) {
              throw new Error('No call ID returned from CALL-E API');
            }
            
            console.log(`   Call created with ID: ${callId}`);
            
            // Step 2: Poll for call completion
            const maxWaitMs = 360_000; // 6 minutes it's timeout for small duration
            const pollIntervalMs = 5_000; // 5 seconds
            const startTime = Date.now();
            
            let callData: any = null;
            // eslint-disable-next-line no-constant-condition
            while (true) {
              await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
              
              const getResponse = await axios.get(
                `${this.baseUrl}/v1/calls/${callId}`,
                { headers, timeout: 10000 }
              );
              
              callData = getResponse.data;
              const status = (callData.status || '').toLowerCase();
              
              console.log(`   Polling call ${callId}: status = ${status}`);
              
              // Terminal states: completed, failed, no_answer, cancelled, canceled
              if (['completed', 'failed', 'no_answer', 'cancelled', 'canceled'].includes(status)) {
                break;
              }
              
              // Timeout check
              if (Date.now() - startTime > maxWaitMs) {
                console.log(`   Polling timed out after ${maxWaitMs}ms`);
                break;
              }
            }
            
            // If we exited the loop due to timeout, callData holds the last known state
            if (!callData) {
              // Fallback to the create response if we never got a get response
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
          } catch (error: any) {
            const status = error.response?.status;
            const errorData = error.response?.data;
            const errorMsg = errorData?.error || errorData?.message || error.message;
            
            console.error('❌ CALL-E HTTP API error:');
            console.error(`   Status: ${status}`);
            console.error(`   Message: ${errorMsg}`);
            console.error(`   Full response:`, JSON.stringify(errorData, null, 2));
            
            if (status === 401) {
              console.error('   💡 Hint: Check that your API key is valid and in the correct format');
            }
            
            throw error;
          }
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
            metadata: { source: 'OpenSlot AI mock flow', target_phone: _opts?.recipients?.[0]?.phones?.[0] || 'unknown' },
          };
        },
      },
    };
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    if (!this.apiKey) {
      console.log('✓ No CALLE_API_KEY configured; using local mock CALL-E client for the demo flow.');
      this.client = this.getMockClient();
      return this.client;
    }

    try {
      console.log('🔄 Attempting to load CALL-E SDK with API key...');
      
      // Try to use the SDK directly
      const mod = await import('@call-e/calle');
      const CalleClient = mod.CalleClient;
      
      if (!CalleClient) {
        throw new Error('CalleClient not found in module');
      }
      
      this.client = new CalleClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
      console.log('✓ CALL-E SDK loaded successfully with your real API key');
      return this.client;
    } catch (error: any) {
      console.warn('⚠ CALL-E SDK import failed, trying HTTP API fallback:', error.message);
      
      try {
        console.log('🔄 Attempting CALL-E HTTP API...');
        this.client = this.getHTTPClient();
        console.log('✓ Using CALL-E HTTP API directly');
        return this.client;
      } catch (fallbackError: any) {
        console.error('⚠ CALL-E HTTP API also failed, using mock client:', fallbackError.message);
        this.client = this.getMockClient();
        return this.client;
      }
    }
  }

  async makeOutboundCall(phone: string, task: string): Promise<OutboundResult> {
    const client = await this.getClient();
    if (!client) {
      return { accepted: false, response_status: 'FAILED', notes: 'CALL-E client unavailable' };
    }

    try {
      const call = await client.calls.createAndWait(
        {
          task,
          recipients: [{ phones: [phone], region: 'IN', locale: 'en-IN' }],
          resultSchema: {
            type: 'object',
            required: ['accepted'],
            properties: {
              accepted: { type: 'string', enum: ['yes', 'no', 'unknown'] },
            },
          },
          metadata: { source: 'OpenSlot AI automated flow', target_phone: phone },
        },
        { idempotencyKey: `openslot-${Date.now()}-${phone.replace(/\D/g, '')}` },
      );

      const rawAccepted =
        call?.structuredResult?.accepted ??
        call?.recipients?.[0]?.structuredResult?.accepted ??
        call?.taskCompleted ??
        'no';

      const accepted = asAccepted(rawAccepted);

      const resultStatus =
        call?.status === 'completed'
          ? accepted
            ? 'ACCEPTED'
            : 'DECLINED'
          : call?.status === 'failed'
            ? 'FAILED'
            : 'NO_ANSWER';

      return {
        accepted,
        notes: call?.summary || call?.failureMessage || 'Outbound CALL-E call completed',
        response_status: resultStatus,
        calle_call_id: call?.id,
        raw: call,
      };
    } catch (error: any) {
      return {
        accepted: false,
        response_status: 'FAILED',
        notes: error?.message || 'CALLE outbound call failed',
      };
    }
  }

  async createReminderCall(phone: string, patientName: string, appointmentTime: Date, providerName: string): Promise<OutboundResult> {
    const reminderTask = `Call ${phone} and speak to ${patientName}. This is a reminder from ${providerName}'s clinic. Tell them their appointment is scheduled for ${appointmentTime.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Ask them to confirm that they can make the visit. If they confirm, politely thank them and end the call. If they decline or do not answer, end politely and note that the clinic will follow up.`;

    return this.makeOutboundCall(phone, reminderTask);
  }

  /**
   * Initiate a CALL-E outbound call and poll the call until it terminates.
   * Returns only when the call is no longer in an in-progress state, so the
   * caller gets the agent's actual final structured result instead of a
   * premature "not accepted" guess.
   */
  async placeCallAndWaitForResult(phone: string, task: string, opts: { maxWaitMs?: number; pollIntervalMs?: number } = {}): Promise<OutboundResult> {
    const maxWaitMs = opts.maxWaitMs ?? 120_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000;

    const client = await this.getClient();
    if (!client) {
      return { accepted: false, response_status: 'FAILED', notes: 'CALL-E client unavailable' };
    }

    const idemKey = `openslot-${Date.now()}-${phone.replace(/\D/g, '')}`;

    let call: any;
    try {
      // Preferred path: SDK supports `createAndWait` which itself blocks until
      // the call finishes. The orchestrator will wait on this promise.
      if (typeof client.calls?.createAndWait === 'function') {
        call = await client.calls.createAndWait(
          {
            task,
            recipients: [{ phones: [phone], region: 'IN', locale: 'en-IN' }],
            resultSchema: {
              type: 'object',
              required: ['accepted'],
              properties: { accepted: { type: 'string', enum: ['yes', 'no', 'unknown'] } },
            },
            metadata: { source: 'OpenSlot AI automated flow', target_phone: phone },
          },
          { idempotencyKey: idemKey },
        );
      } else if (typeof client.calls?.create === 'function') {
        // Fallback: create then poll. Useful for HTTP-only clients.
        const created = await client.calls.create(
          {
            task,
            recipients: [{ phones: [phone], region: 'IN', locale: 'en-IN' }],
            metadata: { source: 'OpenSlot AI automated flow', target_phone: phone },
          },
          { idempotencyKey: idemKey },
        );
        const callId = created?.id || created?.call_id;
        const started = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          if (Date.now() - started > maxWaitMs) {
            return { accepted: false, response_status: 'NO_ANSWER', notes: 'Timed out waiting for call to complete', calle_call_id: callId };
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
      'no';

    const accepted = asAccepted(rawAccepted);
    const status = (call?.status || '').toLowerCase();
    const response_status: OutboundResult['response_status'] =
      status === 'completed' ? (accepted ? 'ACCEPTED' : 'DECLINED')
      : status === 'failed' ? 'FAILED'
      : 'NO_ANSWER';

    return {
      accepted,
      notes: call?.summary || call?.recipients?.[0]?.summary || 'Outbound CALL-E call completed',
      response_status,
      calle_call_id: call?.id,
      raw: call,
    };
  }

  parseWebhook(body: any): OutboundResult {
    if (!body) return { accepted: false, response_status: 'FAILED' };
    const accepted = asAccepted(body.accepted ?? body.structured_output?.accepted ?? body.response_status === 'ACCEPTED');
    return {
      accepted,
      notes: body.notes || body.summary || null,
      response_status: body.response_status || 'FAILED',
      calle_call_id: body.call_id || body.calle_call_id || body.id,
      raw: body,
    };
  }
}
