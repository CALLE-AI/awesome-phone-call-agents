export type RescueStatus =
  | 'idle'
  | 'scanning'
  | 'calling'
  | 'connected'
  | 'waiting_for_response'
  | 'help_confirmed'
  | 'no_responder'
  | 'unknown_response'
  | 'call_failed';

export interface StructuredCallResult {
  response: 'yes' | 'no' | 'unknown';
  notes?: string;
}

export interface RescueRequest {
  id: string;
  phoneNumber: string; // E.164 formatted
  animal: string;
  problem: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  createdAt: string;
  status: RescueStatus;
  callId: string | null;
  callResult: StructuredCallResult | null;
  transcript: string | null;
  summary?: string | null;
  assignedResponder?: {
    name: string;
    typeLabel: string;
    distanceKm: number;
    phone: string;
  } | null;
  error?: string | null;
  demoMode: boolean;
}

export interface CreateRescueRequestBody {
  phoneNumber: string;
  animal: string;
  problem: string;
  latitude: number;
  longitude: number;
  locationName?: string;
}

export interface CalleCreateCallPayload {
  task: string;
  recipients: string[];
  result_schema?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  webhook_url?: string;
  metadata?: Record<string, any>;
}

export interface CalleWebhookPayload {
  id: string;
  type: 'call.completed' | 'call.failed' | 'call.result_validation_failed' | string;
  created_at?: string;
  data: {
    id: string;
    status: string;
    task?: string;
    structured_result?: {
      response?: 'yes' | 'no' | 'unknown' | string;
      notes?: string;
      [key: string]: any;
    } | null;
    transcript?: string | null;
    summary?: string | null;
    metadata?: {
      requestId?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
}
