import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { invoistRequest, multipartFile } from '../shared/transport';

/**
 * The action node: extract a document, fetch one, list them, work the review
 * queue. Each operation is one API call; anything cleverer belongs in the
 * workflow around it, which is the whole point of n8n.
 */
export class Invoist implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Invoist',
		name: 'invoist',
		icon: { light: 'file:../../icons/invoist.svg', dark: 'file:../../icons/invoist.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read invoices and receipts with Invoist',
		defaults: { name: 'Invoist' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'invoistApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Document', value: 'document' },
					{ name: 'Review Item', value: 'reviewItem' },
				],
				default: 'document',
			},

			// --- Document operations ------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'Extract',
						value: 'extract',
						description: 'Upload a file and start reading its fields',
						action: 'Extract a document',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Fetch one document with its extracted fields',
						action: 'Get a document',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List recent documents, newest first',
						action: 'Get many documents',
					},
				],
				default: 'extract',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['extract'] } },
				hint: 'The name of the input binary field containing the file to be read',
				description: 'A PDF, PNG or JPEG under 20 MB',
			},
			{
				displayName: 'Document ID',
				name: 'documentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['get'] } },
				description: 'Usually mapped from a trigger or an Extract step',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				displayOptions: { show: { resource: ['document'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['document'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Done', value: 'done' },
							{ name: 'Failed', value: 'failed' },
							{ name: 'Pending', value: 'pending' },
							{ name: 'Processing', value: 'processing' },
						],
						default: 'done',
					},
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Matches the filename, vendor, invoice number or payment reference',
					},
					{
						displayName: 'Flagged Only',
						name: 'flagged',
						type: 'boolean',
						default: true,
						description: 'Whether to return only documents with items waiting in the review queue',
					},
				],
			},

			// --- Review item operations ---------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['reviewItem'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List items flagged for a second look',
						action: 'Get many review items',
					},
					{
						name: 'Resolve',
						value: 'resolve',
						description: 'Resolve or dismiss a review item',
						action: 'Resolve a review item',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Status',
				name: 'reviewStatus',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Dismissed', value: 'dismissed' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
				],
				default: 'pending',
				displayOptions: { show: { resource: ['reviewItem'], operation: ['getAll'] } },
			},
			{
				displayName: 'Review Item ID',
				name: 'reviewItemId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['reviewItem'], operation: ['resolve'] } },
			},
			{
				displayName: 'Resolution',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Dismissed', value: 'dismissed' },
				],
				default: 'resolved',
				displayOptions: { show: { resource: ['reviewItem'], operation: ['resolve'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'document' && operation === 'extract') {
					const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
					const binary = this.helpers.assertBinaryData(i, binaryProperty);
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
					const form = multipartFile(
						'file',
						buffer,
						binary.fileName ?? 'document.pdf',
						binary.mimeType || 'application/octet-stream',
					);
					const result = await invoistRequest(this, {
						method: 'POST',
						path: '/v1/extract',
						body: form.body,
						json: false,
						headers: { 'Content-Type': form.contentType, Accept: 'application/json' },
					});
					out.push({ json: result, pairedItem: { item: i } });
				} else if (resource === 'document' && operation === 'get') {
					const id = this.getNodeParameter('documentId', i) as string;
					const result = await invoistRequest(this, {
						method: 'GET',
						path: `/v1/documents/${encodeURIComponent(id)}`,
					});
					out.push({ json: result, pairedItem: { item: i } });
				} else if (resource === 'document' && operation === 'getAll') {
					const limit = this.getNodeParameter('limit', i) as number;
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = { limit };
					if (filters.status) qs.status = filters.status;
					if (filters.q) qs.q = filters.q;
					if (filters.flagged) qs.flagged = 'true';
					const result = await invoistRequest(this, { method: 'GET', path: '/v1/documents', qs });
					for (const doc of (result.documents as IDataObject[]) ?? []) {
						out.push({ json: doc, pairedItem: { item: i } });
					}
				} else if (resource === 'reviewItem' && operation === 'getAll') {
					const status = this.getNodeParameter('reviewStatus', i) as string;
					const result = await invoistRequest(this, {
						method: 'GET',
						path: '/v1/review-queue',
						qs: status === 'all' ? {} : { status },
					});
					for (const item of (result.review_queue as IDataObject[]) ?? []) {
						out.push({ json: item, pairedItem: { item: i } });
					}
				} else if (resource === 'reviewItem' && operation === 'resolve') {
					const id = this.getNodeParameter('reviewItemId', i) as string;
					const status = this.getNodeParameter('status', i) as string;
					const result = await invoistRequest(this, {
						method: 'POST',
						path: `/v1/review-queue/${encodeURIComponent(id)}/resolve`,
						body: { status },
					});
					out.push({ json: result, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}.${operation}`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// API failures arrive as NodeApiError already (see transport.ts),
				// with the status and Invoist's own message; keep those intact.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}
		return [out];
	}
}
