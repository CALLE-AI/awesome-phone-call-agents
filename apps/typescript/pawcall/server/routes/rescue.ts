import { Router, Request, Response } from 'express';
import { rescueStore } from '../store/rescueStore';
import { calleService } from '../services/calleService';
import { CreateRescueRequestBody, RescueRequest, RescueStatus } from '../types';

export const rescueRouter = Router();

/**
 * Health check & integration status endpoint
 */
rescueRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    calleConfigured: calleService.isConfigured(),
    demoMode: process.env.DEMO_MODE !== 'false',
    service: 'PawCall AI Emergency Dispatch Backend',
  });
});

/**
 * POST /api/rescue/request
 * Initiates an animal emergency rescue request and starts a CALL-E outbound call.
 */
rescueRouter.post('/request', async (req: Request, res: Response) => {
  try {
    const {
      phoneNumber,
      animal,
      problem,
      latitude,
      longitude,
      locationName,
    } = req.body as CreateRescueRequestBody;

    // Validation
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
      return res.status(400).json({ error: 'Valid phoneNumber is required.' });
    }

    if (!animal || typeof animal !== 'string' || animal.trim() === '') {
      return res.status(400).json({ error: 'Animal type is required.' });
    }

    if (!problem || typeof problem !== 'string' || problem.trim() === '') {
      return res.status(400).json({ error: 'Problem description is required.' });
    }

    const lat = typeof latitude === 'number' ? latitude : parseFloat(latitude) || 28.6139;
    const lng = typeof longitude === 'number' ? longitude : parseFloat(longitude) || 77.2090;

    const normalizedPhone = calleService.normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      return res.status(400).json({
        error: `Invalid phone number format: "${phoneNumber}". Please include country code e.g. +91XXXXXXXXXX or +1XXXXXXXXXX.`,
      });
    }

    // Generate unique PawCall request ID
    const requestId = `paw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    // Create initial in-memory record
    const newRescue: RescueRequest = {
      id: requestId,
      phoneNumber: normalizedPhone,
      animal: animal.trim(),
      problem: problem.trim(),
      latitude: lat,
      longitude: lng,
      locationName: locationName || 'GPS Location Locked',
      createdAt: new Date().toISOString(),
      status: 'calling',
      callId: null,
      callResult: null,
      transcript: null,
      demoMode: process.env.DEMO_MODE !== 'false',
    };

    await rescueStore.create(newRescue);

    // Trigger CALL-E call task
    let callInfo: { callId: string; status: string; task: string };
    try {
      callInfo = await calleService.createRescueCall({
        phoneNumber: normalizedPhone,
        animal: newRescue.animal,
        problem: newRescue.problem,
        latitude: lat,
        longitude: lng,
        locationName: newRescue.locationName,
        requestId,
      });

      await rescueStore.update(requestId, {
        callId: callInfo.callId,
        status: 'calling',
      });
    } catch (callErr: any) {
      console.error(`[Rescue API] CALL-E execution error for ${requestId}:`, callErr);
      await rescueStore.update(requestId, {
        status: 'call_failed',
        error: callErr.message || 'CALL-E failed to place outbound call.',
      });

      return res.status(502).json({
        error: `CALL-E Call Initiation Failed: ${callErr.message}`,
        requestId,
        status: 'call_failed',
      });
    }

    return res.status(201).json({
      requestId,
      status: 'calling',
      callId: callInfo.callId,
      calleConfigured: calleService.isConfigured(),
      phoneNumber: normalizedPhone,
      message: calleService.isConfigured()
        ? `Outbound call placed via CALL-E to ${normalizedPhone}.`
        : `Simulated dispatch active for ${normalizedPhone} (Add CALLE_API_KEY for live calls).`,
    });
  } catch (error: any) {
    console.error('[Rescue API] Error creating rescue request:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/rescue/:requestId
 * Retrieves real-time status of the rescue request & synchronizes with CALL-E
 */
rescueRouter.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const request = await rescueStore.get(requestId);

    if (!request) {
      return res.status(404).json({ error: `Rescue request with ID "${requestId}" not found.` });
    }

    // If active and has a real CALL-E call ID, poll CALL-E API to sync status
    const isActiveState =
      request.status === 'calling' ||
      request.status === 'connected' ||
      request.status === 'waiting_for_response';

    if (isActiveState && request.callId && !request.callId.startsWith('call_sim_')) {
      try {
        const details = await calleService.getCallDetails(request.callId);
        if (details) {
          const updates: Partial<RescueRequest> = {};

          if (details.transcript) {
            updates.transcript = details.transcript;
          }
          if (details.summary) {
            updates.summary = details.summary;
          }

          // Check if call completed and structured result is available
          if (details.structuredResult) {
            updates.callResult = details.structuredResult;
            if (details.structuredResult.response === 'yes') {
              updates.status = 'help_confirmed';
            } else if (details.structuredResult.response === 'no') {
              updates.status = 'no_responder';
            } else {
              updates.status = 'unknown_response';
            }
          } else if (details.status === 'failed' || details.status === 'canceled') {
            updates.status = 'call_failed';
            updates.error = `Call ended with status: ${details.status}`;
          } else if (details.status === 'in_progress' || details.status === 'active') {
            updates.status = 'connected';
          }

          if (Object.keys(updates).length > 0) {
            const updatedRequest = await rescueStore.update(requestId, updates);
            return res.json(updatedRequest || request);
          }
        }
      } catch (pollErr) {
        console.warn(`[Rescue API] Failed polling CALL-E for ${request.callId}:`, pollErr);
      }
    }

    return res.json(request);
  } catch (error: any) {
    console.error('[Rescue API] Error fetching rescue request:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/rescue/:requestId/simulate
 * Manual simulation override for testing edge cases without placing live phone calls
 */
rescueRouter.post('/:requestId/simulate', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { decision } = req.body as { decision: 'yes' | 'no' | 'unknown' };

    const request = await rescueStore.get(requestId);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    let status: RescueStatus = 'unknown_response';
    if (decision === 'yes') status = 'help_confirmed';
    else if (decision === 'no') status = 'no_responder';

    const updated = await rescueStore.update(requestId, {
      status,
      callResult: {
        response: decision,
        notes: `Simulated ${decision.toUpperCase()} decision during local testing.`,
      },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
