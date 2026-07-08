export type JsonObject = Record<string, unknown>;
export interface CreateCallBodyInput {
    task: string;
    phoneNumber: string;
    locale?: string;
    region?: string;
    metadata?: JsonObject;
    resultSchema?: JsonObject;
    recipientResultSchema?: JsonObject;
    webhookUrl?: string;
}
export interface CreateCallBody {
    task: string;
    recipients: Array<{
        phones: string[];
        locale?: string;
        region?: string;
    }>;
    metadata?: JsonObject;
    result_schema?: JsonObject;
    recipient_result_schema?: JsonObject;
    webhook_url?: string;
}
export type CalleBaseUrlValidationResult = {
    ok: true;
    baseUrl: string;
} | {
    ok: false;
    message: string;
};
export declare function assertValidE164PhoneNumber(phoneNumber: string): string;
export declare function parseJsonObject(value: unknown, fieldName: string): JsonObject | undefined;
export declare function buildCreateCallBody(input: CreateCallBodyInput): CreateCallBody;
export declare function isTerminalCallStatus(status: string): boolean;
export declare function maskPhoneNumber(phoneNumber: string): string;
export declare function validateCalleBaseUrl(baseUrl: unknown): CalleBaseUrlValidationResult;
export declare function getPollingSleepMs(pollingInterval: number, deadline: number, now?: number): number;
