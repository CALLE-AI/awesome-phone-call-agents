import type {
  AttemptOutcome,
  ProviderTaskStatus,
} from "@/domain/enums";

export type ApprovedCallBrief = {
  caseId: string;
  attemptId: string;
  contractorDisplayName: string;
  workOrderRef: string;
  recipient: {
    nameOrRole: string;
    phoneE164: string;
    timezone: string;
  };
  disclosure: string;
  objective: string;
  allowedReferenceText: string;
  questions: string[];
  prohibitedActions: string[];
  voicemailPolicy: "do_not_leave";
  maxBoundedClarificationsPerQuestion: 1;
};

export type CreateCallRequest = {
  attemptId: string;
  idempotencyKey: string;
  brief: ApprovedCallBrief;
};

export type ProviderCreationOutcome =
  | {
      disposition: "created" | "duplicate_returned";
      providerCallId: string;
      taskStatus: ProviderTaskStatus;
    }
  | {
      disposition: "failed_before_acceptance";
      errorCode: string;
    }
  | {
      disposition: "ambiguous_requires_reconciliation";
      errorCode: string;
    };

export type ProviderCallSnapshot = {
  providerCallId: string;
  taskStatus: ProviderTaskStatus;
  attemptOutcome: AttemptOutcome;
  structuredResult: unknown;
};

export interface CallProvider {
  readonly providerName: "fake" | "call_e";
  createCall(request: CreateCallRequest): Promise<ProviderCreationOutcome>;
  getCall(providerCallId: string): Promise<ProviderCallSnapshot>;
}
