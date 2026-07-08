"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalleApi = void 0;
class CalleApi {
    constructor() {
        this.name = 'calleApi';
        this.displayName = 'CALL-E API';
        this.icon = { light: 'file:../icons/calle.svg', dark: 'file:../icons/calle.dark.svg' };
        this.documentationUrl = 'https://docs.heycall-e.com/#/authentication';
        this.properties = [
            {
                displayName: 'API Key',
                name: 'apiKey',
                type: 'string',
                typeOptions: { password: true },
                required: true,
                default: '',
                description: 'CALL-E API key for server-side workflow automation',
            },
            {
                displayName: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: 'https://api.heycall-e.com',
                placeholder: 'https://api.heycall-e.com',
                description: 'CALL-E API base URL',
            },
            {
                displayName: 'Request Timeout (MS)',
                name: 'timeout',
                type: 'number',
                default: 30000,
                typeOptions: {
                    minValue: 1000,
                },
                description: 'Maximum time to wait for a single CALL-E API request',
            },
        ];
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    Authorization: '=Bearer {{$credentials.apiKey}}',
                },
            },
        };
    }
}
exports.CalleApi = CalleApi;
//# sourceMappingURL=CalleApi.credentials.js.map