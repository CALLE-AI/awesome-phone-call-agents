export type TransportStatus =
  | "awaiting_customer_form"
  | "follow_up_required"
  | "authorization_complete"
  | "ready_for_driver"
  | "searching_driver"
  | "driver_accepted"
  | "pickup_approaching"
  | "in_transit"
  | "delivery_approaching"
  | "completed"
  | "human_escalation";

export type ContactRole = "customer" | "driver" | "authorized_contact";
export type CallType = "customer-follow-up" | "driver-availability" | "pickup-confirmation" | "delivery-confirmation" | "delay-resolution";
export type AlternateContactStatus = "not_provided" | "provided" | "authorization_pending" | "authorized";
export type QuoteDecision = "pending" | "accepted" | "declined" | "thinking" | "email_requested" | "price_objection";
export type PaymentStatus = "not_requested" | "awaiting_initial_payment" | "initial_paid" | "balance_due" | "paid_in_full";
export type PaymentMethod = "credit_card" | "debit_card" | "ach";

export type CustomerContact = { fullName: string; phone: string; email: string };
export type AuthorizedContact = { fullName: string; phone: string; relationship?: string; authorized: boolean };
export type Vehicle = { year: string; make: string; model: string };
export type PickupDetails = { address: string; preferredWindow: string; presence: "customer" | "alternate"; alternateContact?: AuthorizedContact };
export type DeliveryDetails = { address: string; preferredWindow: string; presence: "customer" | "alternate"; alternateContact?: AuthorizedContact; usePickupAlternate: boolean };

export type TransportQuote = {
  estimateLow: number;
  estimateHigh: number;
  confirmedTotal: number;
  decision: QuoteDecision;
  depositPercent: number;
  initialPayment: number;
  remainingBalance: number;
  paymentStatus: PaymentStatus;
  supportedPaymentMethods: PaymentMethod[];
  securePaymentLinkSent: boolean;
};

export type TransportRequest = {
  reference: string;
  customer: CustomerContact;
  vehicle: Vehicle;
  pickup: PickupDetails;
  delivery: DeliveryDetails;
  status: TransportStatus;
  specialInstructions: string;
  consentToContact: boolean;
  serviceAuthorizationComplete: boolean;
  quote?: TransportQuote;
};

export type TransportRequestForm = TransportRequest;
export type CallTask = { id: string; type: CallType; requestReference: string; recipient: CustomerContact | AuthorizedContact | { fullName: string; phone: string }; recipientRole: ContactRole; reason: string; goal: string; topics: string[] };
export type CallOutcome = { callType: CallType; reached: boolean; confirmedInformation: string[]; unresolvedItems: string[]; nextAction: string; humanEscalation: boolean; notes: string };
export type TransportOperation = { id: string; reference: string; customer: string; vehicle: string; route: string; status: TransportStatus; nextAction: string; isInteractive: boolean; isSample: boolean };
