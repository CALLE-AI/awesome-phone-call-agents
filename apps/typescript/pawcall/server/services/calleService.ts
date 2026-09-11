import { CalleCreateCallPayload, StructuredCallResult } from '../types';

export class CalleService {
  private apiKey: string | undefined;
  private baseUrl = 'https://api.heycall-e.com/v1/calls';
  private isEnabled: boolean;
  private demoMode: boolean;

  constructor() {
    this.apiKey = process.env.CALLE_API_KEY;
    this.isEnabled = process.env.CALLE_ENABLED !== 'false';
    this.demoMode = process.env.DEMO_MODE !== 'false';
  }

  /**
   * Normalize input phone number to E.164 format (+[country][number])
   */
  public normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    // Strip non-digit and non-plus characters
    let cleaned = phone.trim().replace(/[^\d+]/g, '');

    // If starts with +, verify length
    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    // If 10 digits (common for India / US), default prefix
    if (cleaned.length === 10) {
      // Default to +91 if starts with 6-9, else +1
      if (/^[6-9]/.test(cleaned)) {
        return `+91${cleaned}`;
      }
      return `+1${cleaned}`;
    }

    // Prepend + if missing
    return `+${cleaned}`;
  }

  /**
   * Check if real CALL-E integration is configured and enabled
   */
  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && this.isEnabled);
  }

  /**
   * Initiates an outbound goal-driven phone call via CALL-E Developer API
   */
  public async createRescueCall(params: {
    phoneNumber: string;
    animal: string;
    problem: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    requestId: string;
  }): Promise<{ callId: string; status: string; task: string }> {
    const normalizedPhone = this.normalizePhoneNumber(params.phoneNumber);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      throw new Error(`Invalid recipient phone number format: "${params.phoneNumber}"`);
    }

    const locationText = params.locationName
      ? `${params.locationName} (Coordinates: ${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)})`
      : `Coordinates: ${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)}`;

    // Goal-driven task description for CALL-E AI voice agent
    const task =
      `Hello, this is PawCall's emergency rescue assistant. ` +
      `We have an animal emergency that requires urgent assistance. ` +
      `A ${params.animal} is currently ${params.problem} at ${locationText}. ` +
      `Are you able to assist with this rescue? ` +
      `Please determine if the responder can help (yes), cannot help / is unavailable (no), or if their answer is unclear (unknown).`;

    // Structured Result JSON Schema contract
    const resultSchema = {
      type: 'object' as const,
      properties: {
        response: {
          type: 'string',
          enum: ['yes', 'no', 'unknown'],
          description:
            'Set to "yes" if the responder confirmed they can come/assist with the rescue. Set to "no" if they declined, are busy, or cannot help. Set to "unknown" if unclear, ambiguous, or no direct answer.',
        },
        notes: {
          type: 'string',
          description: 'Brief 1-sentence summary of what the responder said.',
        },
      },
      required: ['response'],
    };

    // Determine webhook URL if APP_URL or HOST is present
    let webhookUrl: string | undefined;
    const appUrl = process.env.APP_URL || process.env.PUBLIC_URL;
    if (appUrl && appUrl.startsWith('http')) {
      const cleanUrl = appUrl.replace(/\/+$/, '');
      webhookUrl = `${cleanUrl}/api/calle/webhook`;
    }

    const payload: CalleCreateCallPayload = {
      task,
      recipients: [normalizedPhone],
      result_schema: resultSchema,
      metadata: {
        requestId: params.requestId,
        animal: params.animal,
        demoMode: this.demoMode,
      },
    };

    if (webhookUrl) {
      payload.webhook_url = webhookUrl;
    }

    if (!this.isConfigured()) {
      console.warn(
        `[CALL-E Service] CALLE_API_KEY is not set or disabled. Running in simulated fallback mode for request: ${params.requestId}`
      );
      // Return a simulated call ID so the system functions gracefully in local demo environments
      return {
        callId: `call_sim_${Date.now()}`,
        status: 'calling',
        task,
      };
    }

    console.log(`[CALL-E Service] Calling CALL-E API for ${normalizedPhone} (requestId: ${params.requestId})...`);

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CALL-E Service] CALL-E API error (${response.status}):`, errorText);
      throw new Error(`CALL-E API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`[CALL-E Service] CALL-E Call created successfully:`, data);

    return {
      callId: data.id || data.call_id || `call_${Date.now()}`,
      status: data.status || 'calling',
      task,
    };
  }

  /**
   * Fetches latest call status, structured results, and transcript from CALL-E
   */
  public async getCallDetails(callId: string): Promise<{
    status: string;
    structuredResult: StructuredCallResult | null;
    transcript: string | null;
    summary?: string | null;
  } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (callId.startsWith('call_sim_')) {
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/${callId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[CALL-E Service] Could not fetch call details for ${callId} (${response.status})`);
        return null;
      }

      const data = await response.json();
      const callData = data.data || data;

      let structuredResult: StructuredCallResult | null = null;
      if (callData.structured_result) {
        const rawResp = String(callData.structured_result.response || '').toLowerCase().trim();
        let normalizedResp: 'yes' | 'no' | 'unknown' = 'unknown';
        if (rawResp === 'yes' || rawResp === 'true' || rawResp === 'accept') {
          normalizedResp = 'yes';
        } else if (rawResp === 'no' || rawResp === 'false' || rawResp === 'reject') {
          normalizedResp = 'no';
        }

        structuredResult = {
          response: normalizedResp,
          notes: callData.structured_result.notes || callData.summary,
        };
      }

      return {
        status: callData.status || 'in_progress',
        structuredResult,
        transcript: typeof callData.transcript === 'string' ? callData.transcript : JSON.stringify(callData.transcript),
        summary: callData.summary,
      };
    } catch (err: any) {
      console.error(`[CALL-E Service] Failed fetching call details for ${callId}:`, err);
      return null;
    }
  }
}

export const calleService = new CalleService();
