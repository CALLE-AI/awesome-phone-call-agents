import { Router, Request, Response } from 'express';
import { rescueStore } from '../store/rescueStore';
import { CalleWebhookPayload, RescueStatus, StructuredCallResult } from '../types';

export const calleWebhookRouter = Router();

/**
 * POST /api/calle/webhook
 * Receives asynchronous terminal webhook notifications from CALL-E when a call task completes.
 */
calleWebhookRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const eventIdHeader = req.headers['call-e-event-id'] || req.headers['x-calle-event-id'];
    const payload = req.body as CalleWebhookPayload;

    console.log(`[CALL-E Webhook] Received webhook event:`, {
      type: payload?.type,
      eventId: payload?.id || eventIdHeader,
      callId: payload?.data?.id,
    });

    if (!payload || !payload.data) {
      return res.status(400).json({ error: 'Malformed webhook payload' });
    }

    const { data, type } = payload;
    const callId = data.id;
    const requestId = data.metadata?.requestId;

    // Locate the rescue request in store
    let rescueRequest = requestId
      ? await rescueStore.get(requestId)
      : null;

    if (!rescueRequest && callId) {
      rescueRequest = await rescueStore.getByCallId(callId);
    }

    if (!rescueRequest) {
      console.warn(`[CALL-E Webhook] No matching rescue request found for callId: ${callId}, requestId: ${requestId}`);
      // Return 200 to acknowledge webhook delivery and prevent retries
      return res.status(200).json({ received: true, matched: false });
    }

    // Process structured results
    let newStatus: RescueStatus = rescueRequest.status;
    let callResult: StructuredCallResult | null = rescueRequest.callResult;

    if (data.structured_result) {
      const rawResp = String(data.structured_result.response || '').toLowerCase().trim();
      let normalizedResp: 'yes' | 'no' | 'unknown' = 'unknown';

      if (rawResp === 'yes' || rawResp === 'true' || rawResp === 'accept') {
        normalizedResp = 'yes';
        newStatus = 'help_confirmed';
      } else if (rawResp === 'no' || rawResp === 'false' || rawResp === 'reject') {
        normalizedResp = 'no';
        newStatus = 'no_responder';
      } else {
        normalizedResp = 'unknown';
        newStatus = 'unknown_response';
      }

      callResult = {
        response: normalizedResp,
        notes: data.structured_result.notes || data.summary || undefined,
      };
    } else if (type === 'call.failed' || data.status === 'failed') {
      newStatus = 'call_failed';
    } else if (type === 'call.completed') {
      newStatus = 'unknown_response';
    }

    await rescueStore.update(rescueRequest.id, {
      status: newStatus,
      callResult,
      transcript: typeof data.transcript === 'string' ? data.transcript : JSON.stringify(data.transcript || ''),
      summary: data.summary,
    });

    console.log(`[CALL-E Webhook] Successfully updated request ${rescueRequest.id} -> Status: ${newStatus}`);

    return res.status(200).json({
      received: true,
      requestId: rescueRequest.id,
      status: newStatus,
    });
  } catch (error: any) {
    console.error('[CALL-E Webhook] Error processing webhook:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
