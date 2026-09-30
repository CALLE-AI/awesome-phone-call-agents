export interface TranscriptCustodyMetadata {
  readonly opaqueReference: string;
  readonly integritySha256: string;
  readonly byteLength: number;
}

export interface EvidenceCustodyPort {
  writeProviderTaskReference(input: {
    readonly operationId: string;
    readonly providerTaskId: string;
  }): Promise<void>;
  readProviderTaskReference(input: { readonly operationId: string }): Promise<string>;
  write(input: {
    readonly operationId: string;
    readonly transcript: string;
  }): Promise<TranscriptCustodyMetadata>;
  read(metadata: TranscriptCustodyMetadata): Promise<string>;
}

export type EvidenceCustodyErrorCode =
  "invalid_input" | "capacity_unavailable" | "evidence_unavailable" | "integrity_mismatch";

const custodyMessages: Readonly<Record<EvidenceCustodyErrorCode, string>> = Object.freeze({
  invalid_input: "Transcript custody input is invalid",
  capacity_unavailable: "Transcript custody capacity is unavailable",
  evidence_unavailable: "Transcript custody evidence is unavailable",
  integrity_mismatch: "Transcript custody integrity check failed",
});

export class EvidenceCustodyError extends Error {
  public readonly code: EvidenceCustodyErrorCode;

  public constructor(code: EvidenceCustodyErrorCode) {
    super(custodyMessages[code]);
    this.name = "EvidenceCustodyError";
    this.code = code;
  }
}
