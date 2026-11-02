import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { invoistRequest } from '../shared/transport';

/**
 * The trigger node: n8n gives us a webhook URL, we register it as an Invoist
 * webhook endpoint, and events flow in signed.
 *
 * Lifecycle follows n8n's REST-hook contract exactly: create on activation,
 * delete on deactivation, and checkExists so a restarted n8n does not register
 * the same URL twice. The endpoint id is kept in workflow static data, which
 * is n8n's own place for exactly this.
 */
export class InvoistTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Invoist Trigger',
		name: 'invoistTrigger',
		icon: { light: 'file:../../icons/invoist.svg', dark: 'file:../../icons/invoist.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when something happens in your Invoist workspace',
		defaults: { name: 'Invoist Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'invoistApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['extraction.completed'],
				// The events the API sends today. review_item.created is
				// accepted by the API but never sent, so it is not offered.
				options: [
					{
						name: 'Document Created',
						value: 'document.created',
						description: 'A document arrived, by upload, API, or email',
					},
					{
						name: 'Extraction Completed',
						value: 'extraction.completed',
						description: 'A document was read and its fields are ready',
					},
					{
						name: 'Extraction Failed',
						value: 'extraction.failed',
						description: 'A document could not be read',
					},
					{
						name: 'Review Item Resolved',
						value: 'review_item.resolved',
						description: 'A flagged item was resolved or dismissed',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.endpointId) return false;
				const res = await invoistRequest(this, { method: 'GET', path: '/v1/webhook-endpoints' });
				const endpoints = (res.endpoints as Array<{ id: string }>) ?? [];
				return endpoints.some((e) => e.id === webhookData.endpointId);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];

				const res = await invoistRequest(this, {
					method: 'POST',
					path: '/v1/webhook-endpoints',
					body: { url: webhookUrl, events, description: 'n8n trigger' },
				});
				const endpoint = res.endpoint as { id: string; secret: string };

				const webhookData = this.getWorkflowStaticData('node');
				webhookData.endpointId = endpoint.id;
				// Kept so a future version can verify X-Invoist-Signature on
				// receipt. n8n's static data is per-workflow server state, not
				// anything shown to the user.
				webhookData.endpointSecret = endpoint.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.endpointId) return true;
				try {
					await invoistRequest(this, {
						method: 'DELETE',
						path: `/v1/webhook-endpoints/${webhookData.endpointId as string}`,
					});
				} catch (error) {
					// Already gone on the server: deactivation should still
					// succeed locally rather than wedging the workflow.
					const status = (error as NodeApiError).httpCode;
					if (!(error instanceof NodeApiError) || status !== '404') {
						this.logger.warn('Invoist: could not remove the webhook endpoint', {
							endpointId: webhookData.endpointId,
							error: (error as Error).message,
						});
					}
				}
				delete webhookData.endpointId;
				delete webhookData.endpointSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
