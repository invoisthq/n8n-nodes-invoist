import { randomBytes } from 'node:crypto';

import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.invoi.st';

type Context = IExecuteFunctions | IHookFunctions;

export async function invoistBaseUrl(ctx: Context): Promise<string> {
	const credentials = await ctx.getCredentials('invoistApi');
	return String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * One authenticated call to the Invoist API. `path` starts with /v1. Errors
 * come back as NodeApiError carrying the API's own message, and a household's
 * key (Invoist Personal), which every route here refuses, gets a sentence
 * that says so.
 */
export async function invoistRequest(
	ctx: Context,
	options: Omit<IHttpRequestOptions, 'url'> & { path: string },
): Promise<IDataObject> {
	const { path, ...rest } = options;
	const baseUrl = await invoistBaseUrl(ctx);
	try {
		const response = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'invoistApi', {
			json: true,
			...rest,
			url: `${baseUrl}${path}`,
		})) as unknown;
		return parseJson(response);
	} catch (error) {
		throw toApiError(ctx, error);
	}
}

function parseJson(response: unknown): IDataObject {
	if (response === undefined || response === null || response === '') return {};
	if (typeof response === 'string') return JSON.parse(response) as IDataObject;
	if (Buffer.isBuffer(response)) {
		return response.length ? (JSON.parse(response.toString('utf8')) as IDataObject) : {};
	}
	return response as IDataObject;
}

function toApiError(ctx: Context, error: unknown): NodeApiError {
	if (error instanceof NodeApiError) return error;
	const err = error as JsonObject & {
		response?: { data?: unknown };
		cause?: { response?: { data?: unknown } };
	};
	const data = err.response?.data ?? err.cause?.response?.data;
	let body: { error?: { code?: string; message?: string } } | undefined;
	try {
		body = (typeof data === 'string' ? JSON.parse(data) : data) as typeof body;
	} catch {
		body = undefined;
	}
	const code = body?.error?.code;
	const message = body?.error?.message;
	if (code === 'business_feature') {
		return new NodeApiError(ctx.getNode(), err, {
			message: 'This key is from Invoist Personal',
			description:
				'These nodes work with Invoist for businesses. Create a key in a business workspace instead.',
		});
	}
	return new NodeApiError(ctx.getNode(), err, message ? { message } : {});
}

/**
 * A multipart/form-data body with one file field, built by hand: verified
 * community nodes may not ship dependencies, and a plain buffer goes through
 * every version of n8n's HTTP helper unchanged.
 */
export function multipartFile(
	field: string,
	data: Buffer,
	filename: string,
	contentType: string,
): { body: Buffer; contentType: string } {
	const boundary = `----invoist${randomBytes(12).toString('hex')}`;
	const safeName = filename.replace(/["\r\n]/g, '_');
	const head = Buffer.from(
		`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n` +
			`Content-Type: ${contentType}\r\n\r\n`,
		'utf8',
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
	return {
		body: Buffer.concat([head, data, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}
