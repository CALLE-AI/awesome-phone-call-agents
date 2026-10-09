export type Outcome = "order_requested" | "declined" | "opted_out" | "incomplete" | "unknown";
export type Confirmation = "yes" | "no" | "unknown";
export type DeliveryMethod = "standard" | "pickup" | "unknown";

export interface PurchaseIntent {
  outcome: Outcome;
  items: Array<{ product_id: string; quantity: number }>;
  delivery_method: DeliveryMethod;
  delivery_detail?: string;
  customer_confirmed: Confirmation;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  priceMinor: number;
  currency: "USD";
  active: boolean;
  stock: number;
}

export interface CommerceQuote {
  quoteId: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  subtotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  currency: "USD";
}

export interface PaymentHandoff {
  reference: string;
  status: "demo_ready";
  url: string;
}

export interface CallConsent {
  sessionId: string;
  recipientPhone: string;
  purpose: "conversational_checkout";
  authorizedAt: string;
  consumedAt?: string;
}

export type WorkflowState =
  | "AUTHORIZED"
  | "PREVIEWED"
  | "CALL_SUBMITTING"
  | "CALL_CREATED"
  | "CALL_IN_PROGRESS"
  | "CALL_TERMINAL"
  | "CALL_AMBIGUOUS"
  | "RESULT_REJECTED"
  | "INTENT_VALIDATED"
  | "QUOTE_CREATED"
  | "PAYMENT_HANDOFF_CREATED"
  | "DECLINED"
  | "OPTED_OUT"
  | "NEEDS_REVIEW"
  | "FAILED";

export interface CallSnapshot {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
  recipientPhone?: string;
  structuredResult: Record<string, unknown> | null;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean;
}

export interface CallPlan {
  task: string;
  recipients: Array<{ phones: string[] }>;
  resultSchema: JsonSchema;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface WorkflowOutcome {
  sessionId: string;
  state: WorkflowState;
  reason?: string;
  intent?: PurchaseIntent;
  quote?: CommerceQuote;
  payment?: PaymentHandoff;
}

export interface CommercePort {
  quote(intent: PurchaseIntent, sessionId: string): Promise<CommerceQuote>;
}

export interface PaymentPort {
  createHandoff(quote: CommerceQuote, sessionId: string): Promise<PaymentHandoff>;
}
