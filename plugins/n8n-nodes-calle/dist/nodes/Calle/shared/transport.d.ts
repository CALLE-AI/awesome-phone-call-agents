import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
export declare function calleApiRequest(this: IExecuteFunctions, method: IHttpRequestMethods, path: string, body?: IDataObject, qs?: IDataObject, headers?: IDataObject): Promise<any>;
