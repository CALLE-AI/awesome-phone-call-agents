import type { CallOutcome, CallTask, TransportOperation, TransportRequest } from "../types/transport";
import type { ResolutionReport } from "../types/report";

export const demoRequest: TransportRequest = {
  reference: "AT-0000",
  customer: { fullName: "Amelia Grey", phone: "", email: "amelia.grey@example.test" },
  vehicle: { year: "2011", make: "Volvo", model: "S40" },
  pickup: { address: "1180 S Hope St, Los Angeles, CA", preferredWindow: "Tuesday 2–5 PM", presence: "alternate", alternateContact: { fullName: "Nora Grey", phone: "(213) 555-0182", relationship: "Sister", authorized: false } },
  delivery: { address: "221 W Commerce St, San Antonio, TX", preferredWindow: "Thursday 10 AM–2 PM", presence: "customer", usePickupAlternate: false },
  status: "awaiting_customer_form",
  specialInstructions: "Customer requests a call before driver arrival.",
  consentToContact: true,
  serviceAuthorizationComplete: false,
  quote: {
    estimateLow: 1050,
    estimateHigh: 1250,
    confirmedTotal: 1180,
    decision: "pending",
    depositPercent: 50,
    initialPayment: 590,
    remainingBalance: 590,
    paymentStatus: "not_requested",
    supportedPaymentMethods: ["credit_card", "debit_card", "ach"],
    securePaymentLinkSent: false,
  },
};

export const demoForm = demoRequest;
export const demoCallTask: CallTask = { id: "call-follow-up", type: "customer-follow-up", requestReference: "", recipient: demoRequest.customer, recipientRole: "customer", reason: "Pre-transport coordination", goal: "Confirm the customer, review transport timing and route details, capture questions or special instructions, and determine whether a human coordinator is needed.", topics: ["Identity confirmation", "Transport details", "Pickup timing", "Delivery timing", "Customer questions", "Special instructions", "Human assistance requested"] };

export const demoOperations: TransportOperation[] = [
  { id: "AT-5179", reference: "AT-5179", customer: "Darius Hill", vehicle: "2021 Ford Bronco", route: "Phoenix, AZ → Denver, CO", status: "searching_driver", nextAction: "Driver availability", isInteractive: false, isSample: true },
  { id: "AT-3904", reference: "AT-3904", customer: "Sofia Ramirez", vehicle: "2023 Subaru Outback", route: "Austin, TX → Nashville, TN", status: "pickup_approaching", nextAction: "Pickup confirmation", isInteractive: false, isSample: true },
  { id: "AT-2918", reference: "AT-2918", customer: "Elliot Brooks", vehicle: "2019 BMW X3", route: "Tampa, FL → Raleigh, NC", status: "completed", nextAction: "Delivery recorded", isInteractive: false, isSample: true },
];

export const demoOutcome: CallOutcome = { callType: "customer-follow-up", reached: true, confirmedInformation: ["Customer reached: Yes", "Identity confirmed: Yes", "Transport details confirmed: Yes", "Pickup window discussed: Tuesday 2–5 PM"], unresolvedItems: ["Alternate contact verified: No", "Pickup release authorization is pending"], nextAction: "Review any unresolved questions or authorization details before dispatch.", humanEscalation: true, notes: "Customer requests a call before driver arrival." };

export const demoReport: ResolutionReport = { outcome: { confirmed: demoOutcome.confirmedInformation.map((value) => ({ label: value.split(":")[0], value: value.split(":").slice(1).join(":").trim(), tone: "confirmed" })), unresolved: demoOutcome.unresolvedItems.map((value) => ({ label: value.split(":")[0], value: value.split(":").slice(1).join(":").trim(), tone: "unresolved" })), nextAction: demoOutcome.nextAction, humanEscalation: demoOutcome.humanEscalation, notes: demoOutcome.notes } };
