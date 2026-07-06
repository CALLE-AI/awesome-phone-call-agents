import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type ICredentialDataDecryptedObject,
	type ICredentialsDecrypted,
	type ICredentialTestFunctions,
	type IDataObject,
	type IExecuteFunctions,
	type INodeCredentialTestResult,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject as N8nJsonObject,
} from 'n8n-workflow';
import { calleApiRequest } from './shared/transport';
import {
	buildCreateCallBody,
	getPollingSleepMs,
	isTerminalCallStatus,
	parseJsonObject,
	validateCalleBaseUrl,
} from './shared/utils';

const callOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['call'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a CALL-E call task',
				action: 'Create a call task',
			},
			{
				name: 'Create and Wait',
				value: 'createAndWait',
				description: 'Create a CALL-E call task and poll until it reaches a terminal status',
				action: 'Create a call task and wait for completion',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a CALL-E call task by ID',
				action: 'Get a call task',
			},
			{
				name: 'List Events',
				value: 'listEvents',
				description: 'List developer events for a CALL-E call task',
				action: 'List call task events',
			},
		],
		default: 'create',
	},
];

const createFields: INodeProperties[] = [
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+14155550100',
		description: 'Recipient phone number in E.164 format. Expressions are supported.',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['create', 'createAndWait'],
			},
		},
	},
	{
		displayName: 'Task',
		name: 'task',
		type: 'string',
		required: true,
		default: '',
		typeOptions: {
			rows: 4,
		},
		description: 'The phone agent task boundary and expected outcome',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['create', 'createAndWait'],
			},
		},
	},
	{
		displayName: 'Idempotency Key',
		name: 'idempotencyKey',
		type: 'string',
		required: true,
		default: '={{$execution.id + ":" + $itemIndex}}',
		description: 'Unique key CALL-E can use to avoid duplicate call tasks',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['create', 'createAndWait'],
			},
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['create', 'createAndWait'],
			},
		},
		options: [
			{
				displayName: 'Locale',
				name: 'locale',
				type: 'string',
				default: '',
				placeholder: 'en-US',
				description: 'Language and locale hint for the call',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '',
				description: 'JSON object CALL-E should return with the call task for workflow correlation',
			},
			{
				displayName: 'Recipient Result Schema',
				name: 'recipientResultSchema',
				type: 'json',
				default: '',
				description: 'JSON object schema for each recipient-level structured result',
			},
			{
				displayName: 'Region',
				name: 'region',
				type: 'string',
				default: '',
				placeholder: 'US',
				description: 'Routing or country/region hint for the call',
			},
			{
				displayName: 'Result Schema',
				name: 'resultSchema',
				type: 'json',
				default: '',
				description: 'JSON object schema for the task-level structured result',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/calle/webhook',
				description: 'Optional URL CALL-E should call when the call task reaches a terminal event',
			},
		],
	},
	{
		displayName: 'Polling Interval (MS)',
		name: 'pollingInterval',
		type: 'number',
		default: 2000,
		typeOptions: {
			minValue: 500,
		},
		description: 'How often to poll CALL-E for the call status',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['createAndWait'],
			},
		},
	},
	{
		displayName: 'Timeout (MS)',
		name: 'timeout',
		type: 'number',
		default: 600000,
		typeOptions: {
			minValue: 1000,
		},
		description: 'Maximum time to wait for the call task to reach a terminal status',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['createAndWait'],
			},
		},
	},
];

const getFields: INodeProperties[] = [
	{
		displayName: 'Call ID',
		name: 'callId',
		type: 'string',
		required: true,
		default: '',
		description: 'CALL-E call task ID',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['get', 'listEvents'],
			},
		},
	},
	{
		displayName: 'Cursor',
		name: 'cursor',
		type: 'string',
		default: '',
		description: 'Pagination cursor returned by CALL-E',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['listEvents'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
			maxValue: 100,
		},
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['call'],
				operation: ['listEvents'],
			},
		},
	},
];

export class Calle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'CALL-E',
		name: 'calle',
		icon: { light: 'file:../../icons/calle.svg', dark: 'file:../../icons/calle.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and monitor CALL-E AI-agent phone-call tasks',
		defaults: {
			name: 'CALL-E',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'calleApi',
				required: true,
				testedBy: 'calleApiCredentialTest',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Call',
						value: 'call',
					},
				],
				default: 'call',
			},
			...callOperations,
			...createFields,
			...getFields,
		],
	};

	methods = {
		credentialTest: {
			calleApiCredentialTest,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource !== 'call') {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
						itemIndex,
					});
				}

				const responseData = await executeCallOperation.call(this, operation, itemIndex);

				returnData.push({
					json: responseData,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw toNodeExecutionError.call(this, error, itemIndex);
			}
		}

		return [returnData];
	}
}

async function calleApiCredentialTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};
	const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';

	if (!apiKey) {
		return {
			status: 'Error',
			message: 'API Key is required.',
		};
	}

	const baseUrlValidation = validateCalleBaseUrl(data.baseUrl);

	if (!baseUrlValidation.ok) {
		return {
			status: 'Error',
			message: baseUrlValidation.message,
		};
	}

	return {
		status: 'OK',
		message: 'CALL-E credential settings are valid.',
	};
}

async function executeCallOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'create') {
		return await createCall.call(this, itemIndex);
	}

	if (operation === 'createAndWait') {
		return await createCallAndWait.call(this, itemIndex);
	}

	if (operation === 'get') {
		return await getCall.call(this, itemIndex);
	}

	if (operation === 'listEvents') {
		return await listCallEvents.call(this, itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, {
		itemIndex,
	});
}

async function createCall(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const body = getCreateCallBody.call(this, itemIndex);
	const idempotencyKey = getRequiredStringParameter.call(this, 'idempotencyKey', itemIndex);

	return (await callCalleApi.call(this, 'POST', '/v1/calls', itemIndex, body, {}, {
		'Idempotency-Key': idempotencyKey,
	})) as IDataObject;
}

async function createCallAndWait(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const createdCall = await createCall.call(this, itemIndex);
	const callId = getStringFromResponse.call(this, createdCall, 'id', itemIndex);
	const pollingInterval = getNumberParameter.call(this, 'pollingInterval', itemIndex);
	const timeout = getNumberParameter.call(this, 'timeout', itemIndex);
	const deadline = Date.now() + timeout;

	while (Date.now() <= deadline) {
		const call = await getCallById.call(this, callId, itemIndex);
		const status = typeof call.status === 'string' ? call.status : '';

		if (isTerminalCallStatus(status)) {
			return call;
		}

		const sleepMs = getPollingSleepMs(pollingInterval, deadline);

		if (sleepMs <= 0) {
			break;
		}

		await sleep(sleepMs);
	}

	throw new NodeOperationError(
		this.getNode(),
		`Timed out waiting for CALL-E call ${callId} to complete.`,
		{ itemIndex },
	);
}

async function getCall(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const callId = getRequiredStringParameter.call(this, 'callId', itemIndex);
	return await getCallById.call(this, callId, itemIndex);
}

async function getCallById(
	this: IExecuteFunctions,
	callId: string,
	itemIndex: number,
): Promise<IDataObject> {
	return (await callCalleApi.call(
		this,
		'GET',
		`/v1/calls/${encodeURIComponent(callId)}`,
		itemIndex,
	)) as IDataObject;
}

async function listCallEvents(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const callId = getRequiredStringParameter.call(this, 'callId', itemIndex);
	const cursor = getOptionalStringParameter.call(this, 'cursor', itemIndex);
	const limit = getNumberParameter.call(this, 'limit', itemIndex);
	const qs: IDataObject = { limit };

	if (cursor) {
		qs.cursor = cursor;
	}

	return (await callCalleApi.call(
		this,
		'GET',
		`/v1/calls/${encodeURIComponent(callId)}/events`,
		itemIndex,
		undefined,
		qs,
	)) as IDataObject;
}

function getCreateCallBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const task = getRequiredStringParameter.call(this, 'task', itemIndex);
	const phoneNumber = getRequiredStringParameter.call(this, 'phoneNumber', itemIndex);
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const metadata = parseJsonObject(additionalFields.metadata, 'Metadata');
	const resultSchema = parseJsonObject(additionalFields.resultSchema, 'Result Schema');
	const recipientResultSchema = parseJsonObject(
		additionalFields.recipientResultSchema,
		'Recipient Result Schema',
	);

	return buildCreateCallBody({
		task,
		phoneNumber,
		locale: optionalString(additionalFields.locale),
		region: optionalString(additionalFields.region),
		metadata,
		resultSchema,
		recipientResultSchema,
		webhookUrl: optionalString(additionalFields.webhookUrl),
	}) as unknown as IDataObject;
}

async function callCalleApi(
	this: IExecuteFunctions,
	method: 'GET' | 'POST',
	path: string,
	itemIndex: number,
	body?: IDataObject,
	qs: IDataObject = {},
	headers: IDataObject = {},
): Promise<unknown> {
	try {
		return await calleApiRequest.call(this, method, path, body, qs, headers);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as N8nJsonObject, { itemIndex });
	}
}

function toNodeExecutionError(
	this: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): NodeOperationError | NodeApiError {
	if (error instanceof NodeOperationError || error instanceof NodeApiError) {
		return error;
	}

	return new NodeOperationError(this.getNode(), error as Error, { itemIndex });
}

function getRequiredStringParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string {
	const value = String(this.getNodeParameter(name, itemIndex, '')).trim();

	if (!value) {
		throw new NodeOperationError(this.getNode(), `${name} is required.`, { itemIndex });
	}

	return value;
}

function getOptionalStringParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string | undefined {
	const value = String(this.getNodeParameter(name, itemIndex, '')).trim();
	return value || undefined;
}

function getNumberParameter(this: IExecuteFunctions, name: string, itemIndex: number): number {
	const value = Number(this.getNodeParameter(name, itemIndex));

	if (!Number.isFinite(value) || value <= 0) {
		throw new NodeOperationError(this.getNode(), `${name} must be greater than 0.`, {
			itemIndex,
		});
	}

	return value;
}

function getStringFromResponse(
	this: IExecuteFunctions,
	response: IDataObject,
	field: string,
	itemIndex: number,
): string {
	const value = response[field];

	if (typeof value !== 'string' || !value) {
		throw new NodeOperationError(this.getNode(), `CALL-E response did not include ${field}.`, {
			itemIndex,
		});
	}

	return value;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed || undefined;
}
