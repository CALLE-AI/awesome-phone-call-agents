import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { validateCalleBaseUrl } from './utils';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export async function calleApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs: IDataObject = {},
	headers: IDataObject = {},
) {
	const credentials = await this.getCredentials('calleApi');
	const baseUrlValidation = validateCalleBaseUrl(credentials.baseUrl);

	if (!baseUrlValidation.ok) {
		throw new NodeOperationError(this.getNode(), baseUrlValidation.message);
	}

	const baseUrl = baseUrlValidation.baseUrl;
	const timeout = Number(credentials.timeout || DEFAULT_REQUEST_TIMEOUT_MS);

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		qs,
		body,
		headers,
		json: true,
		timeout,
	};

	return await this.helpers.httpRequestWithAuthentication.call(this, 'calleApi', options);
}
