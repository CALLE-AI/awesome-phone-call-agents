import { EmergencyReport, Responder } from '../types';
import { INITIAL_RESPONDERS, WIDER_SEARCH_RESPONDERS } from '../data/mockResponders';

/**
 * Service layer for PawCall Emergency Dispatch.
 * Designed with a clean interface so simulateCall() can easily be swapped
 * with callResponder() when connecting to real CALL-E / backend voice APIs.
 */

export interface CallSimulationResult {
  accepted: boolean;
  responder: Responder;
  etaMinutes?: number;
  notes?: string;
  transcript?: string;
}

export interface BackendRescueResponse {
  requestId: string;
  status: string;
  callId?: string;
  calleConfigured?: boolean;
  phoneNumber?: string;
  message?: string;
}

export class EmergencyDispatchService {
  /**
   * Discovers nearby responders within radius.
   * In production, this queries the Geo-spatial Rescue registry.
   */
  static async scanNearbyResponders(isWiderSearch = false): Promise<Responder[]> {
    // Returns the responders list for radar plotting
    return isWiderSearch
      ? [...INITIAL_RESPONDERS, ...WIDER_SEARCH_RESPONDERS]
      : INITIAL_RESPONDERS;
  }

  /**
   * Calls PawCall Backend API to create a rescue request and trigger CALL-E outbound voice call.
   */
  static async createBackendRescueRequest(payload: {
    phoneNumber: string;
    animal: string;
    problem: string;
    latitude?: number;
    longitude?: number;
    locationName?: string;
  }): Promise<BackendRescueResponse> {
    try {
      const response = await fetch('/api/rescue/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: payload.phoneNumber,
          animal: payload.animal,
          problem: payload.problem,
          latitude: payload.latitude ?? 28.6139,
          longitude: payload.longitude ?? 77.2090,
          locationName: payload.locationName || 'GPS Location Locked',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create rescue request' }));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      return await response.json();
    } catch (err: any) {
      console.error('[EmergencyService] Failed to create rescue request via backend:', err);
      throw err;
    }
  }

  /**
   * Polls the PawCall backend for real-time CALL-E call progress and structured results
   */
  static async pollBackendRescueStatus(requestId: string): Promise<any> {
    try {
      const response = await fetch(`/api/rescue/${requestId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch rescue status: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      console.warn(`[EmergencyService] Poll error for ${requestId}:`, err);
      return null;
    }
  }

  /**
   * Generates the automated CALL-E AI conversational dispatch script.
   */
  static generateAiVoicePrompt(report: Partial<EmergencyReport>, responder: Responder): string {
    const animal = report.animalType || 'animal';
    const problem = report.description || 'An injured animal needs immediate emergency attention.';
    const location = report.locationName || 'Current GPS coordinates';

    return `Hello ${responder.name}, this is PawCall AI Emergency Dispatch. We have an urgent situation involving a ${animal} reported near ${location}. ${problem}. Are you able to accept and deploy assistance now?`;
  }

  /**
   * Simulates a responder decision on the backend
   */
  static async simulateCall(
    responder: Responder,
    report: Partial<EmergencyReport>,
    userDecision: 'accept' | 'reject'
  ): Promise<CallSimulationResult> {
    const decision = userDecision === 'accept' ? 'yes' : 'no';

    // If there's an active backend requestId, notify backend
    if (report.backendRequestId) {
      fetch(`/api/rescue/${report.backendRequestId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }).catch((e) => console.warn('Simulation sync error:', e));
    }

    if (userDecision === 'accept') {
      const minEta = Math.max(8, Math.round(responder.distanceKm * 5 + 4));
      return {
        accepted: true,
        responder,
        etaMinutes: minEta,
        notes: `Unit dispatched: ${responder.name}. Equipment prepared.`,
      };
    } else {
      return {
        accepted: false,
        responder,
        notes: 'Responder currently responding to another priority rescue.',
      };
    }
  }
}
