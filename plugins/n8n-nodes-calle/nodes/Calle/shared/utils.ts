import { jsonParse } from 'n8n-workflow';

export type JsonObject = Record<string, unknown>;

class CalleValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CalleValidationError';
	}
}

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

export type CalleBaseUrlValidationResult =
	| {
			ok: true;
			baseUrl: string;
	  }
	| {
			ok: false;
			message: string;
	  };

const DEFAULT_BASE_URL = 'https://api.heycall-e.com';
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertValidE164PhoneNumber(phoneNumber: string): string {
	const trimmed = phoneNumber.trim();

	if (!E164_PATTERN.test(trimmed)) {
		throw new CalleValidationError(
			'Phone Number must be in E.164 format, for example +14155550100.',
		);
	}

	return trimmed;
}

export function parseJsonObject(value: unknown, fieldName: string): JsonObject | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const parsed = typeof value === 'string' ? parseJson(value, fieldName) : value;

	if (!isJsonObject(parsed)) {
		throw new CalleValidationError(`${fieldName} must be a JSON object.`);
	}

	return parsed;
}

export function buildCreateCallBody(input: CreateCallBodyInput): CreateCallBody {
	const recipient: CreateCallBody['recipients'][number] = {
		phones: [assertValidE164PhoneNumber(input.phoneNumber)],
	};

	if (input.locale) {
		recipient.locale = input.locale;
	}

	if (input.region) {
		recipient.region = input.region;
	}

	const body: CreateCallBody = {
		task: input.task,
		recipients: [recipient],
	};

	if (input.metadata !== undefined) {
		body.metadata = input.metadata;
	}

	if (input.resultSchema !== undefined) {
		body.result_schema = input.resultSchema;
	}

	if (input.recipientResultSchema !== undefined) {
		body.recipient_result_schema = input.recipientResultSchema;
	}

	if (input.webhookUrl) {
		body.webhook_url = input.webhookUrl;
	}

	return body;
}

export function isTerminalCallStatus(status: string): boolean {
	return status === 'completed' || status === 'failed' || status === 'canceled';
}

export function maskPhoneNumber(phoneNumber: string): string {
	if (phoneNumber.length < 8) {
		return '***';
	}

	return `${phoneNumber.slice(0, 5)}***${phoneNumber.slice(-4)}`;
}

export function validateCalleBaseUrl(baseUrl: unknown): CalleBaseUrlValidationResult {
	const rawBaseUrl = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_BASE_URL;
	let url: URL;

	try {
		url = new URL(rawBaseUrl);
	} catch {
		return {
			ok: false,
			message: 'Base URL must be a valid URL.',
		};
	}

	if (url.protocol !== 'https:' && !isAllowedLoopbackHttpUrl(url)) {
		return {
			ok: false,
			message: 'Base URL must use HTTPS unless it points to localhost, 127.0.0.1, or ::1.',
		};
	}

	return {
		ok: true,
		baseUrl: rawBaseUrl.replace(/\/+$/, ''),
	};
}

export function getPollingSleepMs(pollingInterval: number, deadline: number, now = Date.now()): number {
	const remaining = deadline - now;

	if (remaining <= 0) {
		return 0;
	}

	return Math.min(pollingInterval, remaining);
}

function parseJson(value: string, fieldName: string): unknown {
	return jsonParse(value, { errorMessage: `${fieldName} must contain valid JSON.` });
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedLoopbackHttpUrl(url: URL): boolean {
	return url.protocol === 'http:' && LOOPBACK_HTTP_HOSTS.has(url.hostname.toLowerCase());
}
