import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';

const DEFAULT_BASE_URL = 'https://api.heycall-e.com';
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
	const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
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
