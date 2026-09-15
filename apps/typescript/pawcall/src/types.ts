export type ResponderType = 'clinic' | 'rescue_ngo' | 'shelter' | 'volunteer' | 'wildlife';

export interface Responder {
  id: string;
  name: string;
  type: ResponderType;
  typeLabel: string;
  distanceKm: number;
  phone: string;
  avatarIcon: string;
  rating?: number;
  available: boolean;
  angle: number; // For radar positioning (0 to 360 deg)
  radiusPercent: number; // Distance on radar from center (25% to 85%)
  delayAppearMs: number;
}

export interface EmergencyReport {
  id: string;
  backendRequestId?: string;
  timestamp: Date;
  locationName: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  animalType: string;
  imageUrl?: string;
  description: string;
  urgency: 'critical' | 'urgent' | 'moderate';
  callerPhone?: string;
  status: 'pending' | 'scanning' | 'calling' | 'confirmed' | 'unresolved' | 'cancelled';
  assignedResponder?: Responder;
  etaMinutes?: number;
  backendStatus?: string;
  callResult?: {
    response: 'yes' | 'no' | 'unknown';
    notes?: string;
  };
  transcript?: string;
  isRealCalle?: boolean;
}

export type AppState =
  | 'IDLE'
  | 'EMERGENCY_FORM'
  | 'SCANNING'
  | 'TEST_CALL_SETUP'
  | 'CALLING'
  | 'SUCCESS'
  | 'NO_RESPONDER_AVAILABLE'
  | 'UNKNOWN_RESPONSE'
  | 'CALL_FAILED';

export interface CallTranscriptMessage {
  id: string;
  speaker: 'PAWCALL_AI' | 'RESPONDER';
  text: string;
  timestamp: string;
}

export type TabType = 'sos' | 'history' | 'about';
