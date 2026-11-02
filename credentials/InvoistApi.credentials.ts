import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * One field: the workspace API key. Every request carries it as a bearer
 * token, and the credential test hits the cheapest authenticated endpoint so
 * a typo fails at setup rather than mid-workflow.
 */
export class InvoistApi implements ICredentialType {
	name = 'invoistApi';

	displayName = 'Invoist API';

	icon: Icon = { light: 'file:../icons/invoist.svg', dark: 'file:../icons/invoist.dark.svg' };

	documentationUrl =
		'https://github.com/invoisthq/n8n-nodes-invoist?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in Invoist under Integrations › API. It starts with inv_sk_ and works for one business workspace.',
		},
		{
			displayName: 'API Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.invoi.st',
			description: 'Only change this for a self-hosted or staging Invoist',
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

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/usage',
		},
	};
}
