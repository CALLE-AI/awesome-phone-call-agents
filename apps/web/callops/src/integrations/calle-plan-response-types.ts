export type JsonValueType =
  | 'absent'
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object';

export type CalleStructuredPayloadPath =
  | 'result.structuredContent'
  | 'result.structured_content'
  | `result.content[${number}].text`
  | 'cli.result.structuredContent'
  | 'cli.result.structured_content'
  | `cli.result.content[${number}].text`;

export interface SanitizedBooleanFieldObservation {
  readonly present: boolean;
  readonly type: JsonValueType;
  readonly value: boolean | null;
}

export interface SanitizedOpaqueFieldObservation {
  readonly present: boolean;
  readonly type: JsonValueType;
  readonly nonEmptyString: boolean;
}

export interface SanitizedTextFieldObservation {
  readonly present: boolean;
  readonly type: JsonValueType;
  readonly sanitizedText?: string;
}

export interface SanitizedCallePlanObservation {
  readonly structuredPayloadPath: CalleStructuredPayloadPath | null;
  readonly readyToRun: SanitizedBooleanFieldObservation;
  readonly planId: SanitizedOpaqueFieldObservation;
  readonly confirmToken: SanitizedOpaqueFieldObservation;
  readonly clarification: SanitizedTextFieldObservation;
  readonly nextStep: SanitizedTextFieldObservation;
  readonly missingInformationPresent: boolean;
  readonly unexpectedFields: readonly string[];
}

export type CallePlanContractResult =
  | {
      readonly kind: 'NEEDS_DETAILS';
      readonly observation: SanitizedCallePlanObservation;
      readonly clarification: string | null;
    }
  | {
      readonly kind: 'READY_TO_RUN';
      readonly observation: SanitizedCallePlanObservation;
      readonly opaqueCapabilityHeldOnlyInMemory: true;
    }
  | {
      readonly kind: 'SCHEMA_DRIFT';
      readonly observation: SanitizedCallePlanObservation;
      readonly reason: string;
    }
  | {
      readonly kind: 'INDETERMINATE';
      readonly observation: SanitizedCallePlanObservation;
      readonly reason: string;
    };
