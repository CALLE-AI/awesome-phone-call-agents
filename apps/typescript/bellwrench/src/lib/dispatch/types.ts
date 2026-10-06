export type Urgency = "routine" | "soon" | "urgent";

export interface WorkOrder {
  title: string;
  issue: string;
  property: string;
  location: string;
  urgency: Urgency;
  disclosure: string;
  maximumAuthorizedAction: "information_only";
}

export interface Vendor {
  id: string;
  name: string;
  trade: string;
  phone: string;
  authorized: boolean;
  selected: boolean;
}

export interface DispatchRequest {
  workOrder: WorkOrder;
  vendors: Vendor[];
  confirmedRealCalls: boolean;
  dispatchId: string;
}

export type VendorAvailability = "available" | "unavailable" | "unknown";
export type PriceType = "fixed" | "estimate" | "quote_required" | "not_provided";
export type VendorOutcomeStatus = "verified" | "incomplete" | "failed" | "unknown";

export interface VendorCallResult {
  vendorId: string;
  vendorName: string;
  status: VendorOutcomeStatus;
  callId: string | null;
  callStatus: string | null;
  recipientStatus: string | null;
  taskCompleted: boolean | null;
  availability: VendorAvailability;
  earliestEta: string | null;
  priceType: PriceType;
  priceAmount: number | null;
  currency: string | null;
  constraints: string[];
  completionConfidence: string | null;
  confidenceScore: number | null;
  summary: string | null;
  evidence: string[];
  failureCode: string | null;
}

export type DispatchAggregateStatus =
  | "completed"
  | "partial"
  | "failed"
  | "unresolved";

export interface DispatchApiResponse {
  status?: DispatchAggregateStatus;
  code?: string;
  message: string;
  results?: VendorCallResult[];
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface DispatchDecision {
  dispatchId: string;
  kind: "vendor_selected" | "no_dispatch";
  vendorId: string | null;
  vendorName: string | null;
  callId: string | null;
  note: string;
  recordedAt: string;
  bookingStatus: "not_booked";
}

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationError[] };
