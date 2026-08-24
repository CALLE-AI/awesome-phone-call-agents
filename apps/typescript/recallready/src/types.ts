export type RemedyKind =
  | "refund"
  | "repair"
  | "replace"
  | "dispose"
  | "new_instructions"
  | "unknown";

export type Eligibility =
  | "confirmed"
  | "not_confirmed"
  | "needs_more_information"
  | "unknown";

export interface CpscRecall {
  id: number;
  number: string;
  date: string;
  title: string;
  description: string;
  officialUrl: string;
  consumerContact: string;
  products: Array<{ name: string; units: string }>;
  hazards: string[];
  remedies: string[];
  remedyOptions: string[];
}

export interface PreviewInput {
  recallId: number;
  modelNumber: string;
  dateCode?: string;
  demoPhone?: string;
  demoConsent?: boolean;
}

export interface CallPreview {
  previewId: string;
  expiresAt: string;
  maskedPhone: string;
  phoneSource: "official_recall_record" | "authorized_demo";
  product: string;
  modelNumber: string;
  dateCode: string | null;
  callGoal: string;
  boundaries: string[];
  officialRecordUrl: string;
  liveCallsEnabled: boolean;
}

export interface CallResult {
  provider: "mock" | "call-e";
  status: string;
  taskCompleted: boolean;
  eligibility: Eligibility;
  remedy: RemedyKind;
  requiredProof: string;
  nextStep: string;
  deadline: string | null;
  needsHuman: boolean;
  caseReference: string | null;
  confidence: number;
  evidence: string[];
  callId: string;
}

export interface PendingPreview {
  preview: CallPreview;
  phone: string;
  task: string;
  recall: CpscRecall;
  consumed: boolean;
}
