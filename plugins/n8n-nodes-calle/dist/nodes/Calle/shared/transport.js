"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calleApiRequest = calleApiRequest;
const n8n_workflow_1 = require("n8n-workflow");
const utils_1 = require("./utils");
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
async function calleApiRequest(method, path, body, qs = {}, headers = {}) {
    const credentials = await this.getCredentials('calleApi');
    const baseUrlValidation = (0, utils_1.validateCalleBaseUrl)(credentials.baseUrl);
    if (!baseUrlValidation.ok) {
        throw new n8n_workflow_1.NodeOperationError(this.getNode(), baseUrlValidation.message);
    }
    const baseUrl = baseUrlValidation.baseUrl;
    const timeout = Number(credentials.timeout || DEFAULT_REQUEST_TIMEOUT_MS);
    const options = {
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
//# sourceMappingURL=transport.js.map