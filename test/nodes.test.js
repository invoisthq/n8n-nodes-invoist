'use strict';

// Runs the built nodes (dist/) the way n8n would call them, with n8n's
// helpers replaced by small fakes. Offline by default; set INVOIST_TEST_KEY
// (and INVOIST_TEST_URL, default http://localhost:8081) to also run them
// against a live API. Plain JavaScript on purpose: the package's linter
// covers the shipped TypeScript, and tests are never part of the package.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Invoist } = require('../dist/nodes/Invoist/Invoist.node');
const { InvoistTrigger } = require('../dist/nodes/InvoistTrigger/InvoistTrigger.node');
const { InvoistApi } = require('../dist/credentials/InvoistApi.credentials');
const { multipartFile } = require('../dist/nodes/shared/transport');

const KEY = process.env.INVOIST_TEST_KEY ?? '';
const LIVE_URL = process.env.INVOIST_TEST_URL ?? 'http://localhost:8081';

// The monorepo's contract and dispatcher, when the tests run inside it (the
// public mirror has neither, and skips those checks).
const REPO = path.resolve(__dirname, '../../..');
const OPENAPI = path.join(REPO, 'app/backend/openapi.yaml');
const BACKEND = path.join(REPO, 'app/backend/internal');
const inMonorepo = fs.existsSync(OPENAPI);

const DOC_ID = '01a02f72-4dc2-758e-ab61-44254e5ee7f3';
const EXT_ID = '01a02f72-4dd4-7dbd-93c2-fff893267199';
const ITEM_ID = '01a02f80-1b7c-7e0a-9c55-2d6b1f0e4a11';
const EP_ID = '01a02f90-0000-7000-8000-00000000abcd';

function contractOperations() {
	const ops = new Set();
	let current = null;
	for (const line of fs.readFileSync(OPENAPI, 'utf8').split('\n')) {
		const p = line.match(/^ {2}(\/v1\/[^:]+):\s*$/);
		if (p) {
			current = p[1];
			continue;
		}
		if (/^\S/.test(line)) current = null;
		const m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
		if (current && m) ops.add(`${m[1].toUpperCase()} ${current}`);
	}
	return ops;
}

function templated(url) {
	return new URL(url).pathname.replace(
		/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/g,
		'/{id}',
	);
}

// Canned answers in the shapes openapi.yaml declares.
function fakeApi(request) {
	const route = `${request.method} ${templated(request.url)}`;
	switch (route) {
		case 'POST /v1/extract':
			return {
				document: { id: DOC_ID, original_filename: 'a.pdf', status: 'pending' },
				extraction: { id: EXT_ID, status: 'pending' },
				duplicate: false,
			};
		case 'GET /v1/documents/{id}':
			return { document: { id: DOC_ID }, extraction: { id: EXT_ID, status: 'done' }, review_queue: [] };
		case 'GET /v1/documents':
			return { documents: [{ id: DOC_ID }, { id: EXT_ID }] };
		case 'GET /v1/review-queue':
			return { review_queue: [{ id: ITEM_ID, document_id: DOC_ID, status: 'pending' }] };
		case 'POST /v1/review-queue/{id}/resolve':
			return { review_queue_item: { id: ITEM_ID, status: request.body.status } };
		case 'GET /v1/webhook-endpoints':
			return { endpoints: [{ id: EP_ID }], known_events: [] };
		case 'POST /v1/webhook-endpoints':
			return { endpoint: { id: EP_ID, secret: 'whsec_x', events: request.body.events } };
		case 'DELETE /v1/webhook-endpoints/{id}':
			return '';
		default:
			throw new Error(`fake API has no ${route}`);
	}
}

// What the credential's `authenticate` block declares, done by hand, against
// either the fake or a live API.
function authedRequest(calls, live) {
	return async function httpRequestWithAuthentication(credentialName, options) {
		assert.equal(credentialName, 'invoistApi');
		const url = new URL(options.url);
		for (const [k, v] of Object.entries(options.qs ?? {})) url.searchParams.set(k, String(v));
		const request = { ...options, method: options.method ?? 'GET', url: url.toString() };
		calls.push(request);
		if (!live) return fakeApi(request);
		const isBuffer = Buffer.isBuffer(options.body);
		const res = await fetch(request.url, {
			method: request.method,
			headers: {
				Authorization: `Bearer ${KEY}`,
				...(options.body && !isBuffer ? { 'Content-Type': 'application/json' } : {}),
				...(options.headers ?? {}),
			},
			body: options.body ? (isBuffer ? options.body : JSON.stringify(options.body)) : undefined,
		});
		const text = await res.text();
		if (!res.ok) {
			const err = new Error(`http ${res.status}`);
			err.httpCode = String(res.status);
			err.response = { status: res.status, data: text };
			throw err;
		}
		return text ? JSON.parse(text) : '';
	};
}

function baseCtx(calls, live = false) {
	return {
		getNode: () => ({ name: 'Invoist', type: 'n8n-nodes-invoist.invoist', typeVersion: 1, parameters: {} }),
		getCredentials: async () => ({ apiKey: KEY || 'inv_sk_test', baseUrl: live ? LIVE_URL : 'https://api.invoi.st/' }),
		logger: { warn() {}, debug() {}, info() {}, error() {} },
		helpers: { httpRequestWithAuthentication: authedRequest(calls, live) },
	};
}

function execCtx(calls, params, live = false) {
	const ctx = baseCtx(calls, live);
	const file = Buffer.from('%PDF-1.4\n%fake\n');
	return {
		...ctx,
		getInputData: () => [{ json: {}, binary: { data: { fileName: 'a.pdf', mimeType: 'application/pdf' } } }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		continueOnFail: () => false,
		helpers: {
			...ctx.helpers,
			assertBinaryData: () => ({ fileName: 'a.pdf', mimeType: 'application/pdf' }),
			getBinaryDataBuffer: async () => file,
		},
	};
}

function hookCtx(calls, staticData, events, live = false) {
	return {
		...baseCtx(calls, live),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
		getNodeParameter: () => events,
	};
}

const OPERATIONS = [
	{ resource: 'document', operation: 'extract', binaryProperty: 'data' },
	{ resource: 'document', operation: 'get', documentId: DOC_ID },
	{ resource: 'document', operation: 'getAll', limit: 5, filters: { status: 'done', q: 'helen', flagged: true } },
	{ resource: 'reviewItem', operation: 'getAll', reviewStatus: 'pending' },
	{ resource: 'reviewItem', operation: 'getAll', reviewStatus: 'all' },
	{ resource: 'reviewItem', operation: 'resolve', reviewItemId: ITEM_ID, status: 'dismissed' },
];

async function runEverything() {
	const calls = [];
	const node = new Invoist();
	for (const params of OPERATIONS) await node.execute.call(execCtx(calls, params));
	const trigger = new InvoistTrigger();
	const staticData = {};
	const ctx = hookCtx(calls, staticData, ['extraction.completed']);
	await trigger.webhookMethods.default.create.call(ctx);
	await trigger.webhookMethods.default.checkExists.call(ctx);
	await trigger.webhookMethods.default.delete.call(ctx);
	return calls;
}

test('nodes and credential are wired for n8n', () => {
	const action = new Invoist();
	const trigger = new InvoistTrigger();
	const credential = new InvoistApi();
	assert.equal(action.description.name, 'invoist');
	assert.equal(trigger.description.name, 'invoistTrigger');
	assert.equal(credential.name, 'invoistApi');
	assert.equal(action.description.credentials[0].name, credential.name);
	assert.equal(trigger.description.credentials[0].name, credential.name);
	assert.ok(trigger.description.webhooks.length, 'trigger declares a webhook');

	// Everything package.json registers is built.
	const pkg = require('../package.json');
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
		assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} is built`);
	}
	for (const icon of ['dist/icons/invoist.svg', 'dist/icons/invoist.dark.svg']) {
		assert.ok(fs.existsSync(path.join(__dirname, '..', icon)), `${icon} is copied`);
	}
});

test('every request is an operation in openapi.yaml', { skip: !inMonorepo && 'openapi.yaml not found' }, async () => {
	const ops = contractOperations();
	const calls = await runEverything();
	assert.equal(calls.length, OPERATIONS.length + 3);
	for (const call of calls) {
		const route = `${call.method} ${templated(call.url)}`;
		assert.ok(ops.has(route), `${route} is not in openapi.yaml`);
		assert.ok(call.url.startsWith('https://api.invoi.st/v1/'), `base URL trailing slash handled: ${call.url}`);
	}
});

test('operations send what the API expects', async () => {
	const calls = await runEverything();
	const byRoute = (method, p) => calls.filter((c) => c.method === method && new URL(c.url).pathname === p);

	const [extract] = byRoute('POST', '/v1/extract');
	assert.match(extract.headers['Content-Type'], /^multipart\/form-data; boundary=/);
	const text = extract.body.toString('utf8');
	assert.match(text, /Content-Disposition: form-data; name="file"; filename="a.pdf"/);
	assert.match(text, /%PDF-1.4/);

	const [list] = byRoute('GET', '/v1/documents');
	const qs = new URL(list.url).searchParams;
	assert.equal(qs.get('limit'), '5');
	assert.equal(qs.get('status'), 'done');
	assert.equal(qs.get('flagged'), 'true');

	const reviews = byRoute('GET', '/v1/review-queue');
	assert.equal(new URL(reviews[0].url).searchParams.get('status'), 'pending');
	assert.equal(new URL(reviews[1].url).searchParams.get('status'), null, '"All" sends no filter');

	const [resolve] = calls.filter((c) => c.url.endsWith('/resolve'));
	assert.deepEqual(resolve.body, { status: 'dismissed' });
});

test('list operations return one item per record', async () => {
	const out = await new Invoist().execute.call(
		execCtx([], { resource: 'document', operation: 'getAll', limit: 2, filters: {} }),
	);
	assert.equal(out[0].length, 2);
	assert.equal(out[0][0].json.id, DOC_ID);
	assert.deepEqual(out[0][1].pairedItem, { item: 0 });
});

test('trigger events are ones the API sends', { skip: !inMonorepo && 'backend not found' }, () => {
	const dispatcher = fs.readFileSync(path.join(BACKEND, 'webhooks/dispatcher.go'), 'utf8');
	const callers = fs
		.readdirSync(path.join(BACKEND, 'httpapi'))
		.filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
		.map((f) => fs.readFileSync(path.join(BACKEND, 'httpapi', f), 'utf8'))
		.join('\n');
	const sent = new Set(
		[...dispatcher.matchAll(/(Event\w+)\s*=\s*"([a-z_.]+)"/g)]
			.filter(([, name]) => callers.includes(`webhooks.${name}`))
			.map(([, , value]) => value),
	);
	const offered = new InvoistTrigger().description.properties[0].options.map((o) => o.value);
	assert.ok(offered.length >= 4);
	for (const ev of offered) assert.ok(sent.has(ev), `${ev} is never sent by the API`);
});

test("a household's key gets a plain explanation", async () => {
	const ctx = execCtx([], { resource: 'document', operation: 'get', documentId: DOC_ID });
	ctx.helpers.httpRequestWithAuthentication = async () => {
		const err = new Error('Request failed with status code 403');
		err.httpCode = '403';
		err.response = {
			status: 403,
			data: { error: { code: 'business_feature', message: "isn't included in Invoist Personal" } },
		};
		throw err;
	};
	await assert.rejects(new Invoist().execute.call(ctx), (error) => {
		assert.equal(error.name, 'NodeApiError');
		assert.match(error.message, /Invoist Personal/);
		return true;
	});
});

test('the API error message reaches the user', async () => {
	const ctx = execCtx([], { resource: 'document', operation: 'get', documentId: DOC_ID });
	ctx.helpers.httpRequestWithAuthentication = async () => {
		const err = new Error('Request failed with status code 404');
		err.httpCode = '404';
		err.response = { status: 404, data: '{"error":{"code":"not_found","message":"document not found"}}' };
		throw err;
	};
	await assert.rejects(new Invoist().execute.call(ctx), /document not found/);
});

test('multipart body is well formed', () => {
	const { body, contentType } = multipartFile('file', Buffer.from('abc'), 'we"ird\r\n.pdf', 'application/pdf');
	const boundary = contractBoundary(contentType);
	const text = body.toString('utf8');
	assert.ok(text.startsWith(`--${boundary}\r\n`));
	assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`));
	assert.match(text, /filename="we_ird__\.pdf"/, 'quotes and newlines cannot break the header');
	assert.match(text, /\r\n\r\nabc\r\n/);
});

function contractBoundary(contentType) {
	const m = contentType.match(/boundary=(.+)$/);
	assert.ok(m, 'boundary present');
	return m[1];
}

test("webhook() hands the event body through", async () => {
	const body = { id: 'evt_1', type: 'extraction.completed', data: { document_id: 'd1' } };
	const out = await new InvoistTrigger().webhook.call({
		getBodyData: () => body,
		helpers: { returnJsonArray: (b) => [{ json: b }] },
	});
	assert.deepEqual(out.workflowData[0][0].json, body);
});

test('deactivating survives an endpoint that is already gone', async () => {
	const staticData = { endpointId: EP_ID, endpointSecret: 'whsec_x' };
	const ctx = hookCtx([], staticData, []);
	ctx.helpers.httpRequestWithAuthentication = async () => {
		const err = new Error('Request failed with status code 404');
		err.response = { status: 404, data: '' };
		throw err;
	};
	assert.equal(await new InvoistTrigger().webhookMethods.default.delete.call(ctx), true);
	assert.deepEqual(staticData, {});
});

// --- Live API ---------------------------------------------------------------

test('trigger lifecycle against the live API', { skip: !KEY && 'set INVOIST_TEST_KEY' }, async () => {
	const trigger = new InvoistTrigger();
	const staticData = {};
	const ctx = hookCtx([], staticData, ['extraction.completed'], true);

	assert.equal(await trigger.webhookMethods.default.checkExists.call(ctx), false);
	assert.equal(await trigger.webhookMethods.default.create.call(ctx), true);
	assert.ok(staticData.endpointId, 'endpoint id stored');
	assert.match(String(staticData.endpointSecret), /^whsec_/);
	assert.equal(await trigger.webhookMethods.default.checkExists.call(ctx), true);
	assert.equal(await trigger.webhookMethods.default.delete.call(ctx), true);
	assert.equal(staticData.endpointId, undefined);
	assert.equal(await trigger.webhookMethods.default.checkExists.call(ctx), false);
});

test('extract and fetch a document against the live API', { skip: !KEY && 'set INVOIST_TEST_KEY' }, async () => {
	const node = new Invoist();
	const [[extracted]] = await node.execute.call(
		execCtx([], { resource: 'document', operation: 'extract', binaryProperty: 'data' }, true),
	);
	assert.ok(extracted.json.document.id);
	const [[found]] = await node.execute.call(
		execCtx([], { resource: 'document', operation: 'get', documentId: extracted.json.document.id }, true),
	);
	assert.equal(found.json.document.id, extracted.json.document.id);
});
