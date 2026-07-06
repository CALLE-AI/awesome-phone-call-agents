import type { IAuthenticateGeneric, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

export class CalleApi implements ICredentialType {
	name = 'calleApi';

	displayName = 'CALL-E API';

	icon: Icon = { light: 'file:../icons/calle.svg', dark: 'file:../icons/calle.dark.svg' };

	documentationUrl = 'https://docs.heycall-e.com/#/authentication';

	properties: INodeProperties[] = [
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

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
}
