export type CallJobStatus = "pending" | "in-progress" | "completed" | "failed";

export interface ExtractedQuote {
  inStock: boolean;
  unitPrice: number | null;
  alternativeOffered: string | null;
  deliveryAvailable: boolean | null;
  representativeName: string | null;
  notes: string | null;
}

export interface VendorTask {
  id: string;
  vendorName: string;
  phoneNumber: string;
  region: string;
  locale: string;
  item: string;
  targetQuantity: number;
}

export interface CallJob {
  id: string;
  calleCallId: string | null;
  task: VendorTask;
  status: CallJobStatus;
  quote: ExtractedQuote | null;
  transcript: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
