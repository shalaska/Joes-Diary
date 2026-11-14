import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAskHandler } from './agent.js';
import { createGeminiClient, createGeminiToolClient } from './gemini.js';
import { createHandler } from './handler.js';
import { createMcpHandler, SCOPES } from './mcp.js';
import { annotateSpan, createTokenSource, routeName, setUpTracing, traceRequest, withSpan } from './tracing.js';
import { trace } from '@opentelemetry/api';

// A string that stands for diary text. It goes into every input, model reply and stored entry;
// no span may ever carry it.
const CANARY = 'CANARY-7f3a private diary words';

const exporter = new InMemorySpanExporter();
let tracing;
beforeAll(() => {
    tracing = setUpTracing({ projectId: 'demo-project', exporter, getToken: async () => 'unused' });
});
afterEach(() => exporter.reset());

const spans = async () => {
    await tracing.flush();
    return exporter.getFinishedSpans();
};
const byName = (list, name) => list.find(s => s.name === name);
const everything = (list) => JSON.stringify(list.map(s => ({ name: s.name, attributes: s.attributes, events: s.events, status: s.status, resource: s.resource.attributes })));

// A fake Gemini API: answers each request with the next reply in the script.
const geminiFetch = (replies) => async () => {
    const reply = replies.shift();
    if (reply.status) return new Response('{}', { status: reply.status });
    return new Response(JSON.stringify({
        candidates: [{ content: { role: 'model', parts: reply.parts }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
        modelVersion: 'gemini-test-001',
    }), { status: 200 });
};

const ENTRIES = [{ date: '2026-11-10T08:00:00.000Z', groupId: 'Tue Nov 10 2026', content: `Today: ${CANARY}` }];
const store = {
    entries: async () => ENTRIES,
    todos: async () => [{ text: CANARY, priority: 'high', completed: false }],
    saveProposals: async (docs) => docs.map((_, i) => `p${i}`),
    pendingProposalCount: async () => 0,
};

describe('live tracing', () => {
    it('traces a quick feature as a request span with its Gemini call inside', async () => {
        const handle = createHandler({
            model: 'gemini-test',
            callModel: createGeminiClient({ apiKey: 'k', fetchImpl: geminiFetch([{ parts: [{ text: `Tidied: ${CANARY}` }] }]) }),
            log: annotateSpan,
        });
        await traceRequest(tracing, 'llm edit', { 'diary.feature': 'edit' }, () => handle({ feature: 'edit', input: { selection: CANARY, instruction: CANARY } }));
        const list = await spans();

        const root = byName(list, 'llm edit');
        const model = byName(list, 'generate_content gemini-test');
        expect(model.parentSpanContext.spanId).toBe(root.spanContext().spanId);
        expect(root.parentSpanContext).toBeUndefined();
        expect(root.resource.attributes).toMatchObject({ 'service.name': 'joes-diary-gateway', 'gcp.project_id': 'demo-project' });
        expect(model.attributes).toMatchObject({
            'gen_ai.operation.name': 'generate_content', 'gen_ai.provider.name': 'gcp.gemini', 'gen_ai.request.model': 'gemini-test',
            'gen_ai.response.model': 'gemini-test-001', 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 25, 'gen_ai.response.finish_reasons': ['STOP'],
        });
        expect(root.attributes).toMatchObject({ 'diary.feature': 'edit', 'diary.outcome': 'ok', 'diary.prompt_version': 'edit-v1' });
        expect(root.status.code).toBe(SpanStatusCode.UNSET);
        expect(everything(list)).not.toContain('CANARY');
    });

    it('traces an Ask run: each model turn and each tool call, never the question, entries or answer', async () => {
        const ask = createAskHandler({
            model: 'gemini-test',
            callTools: createGeminiToolClient({ apiKey: 'k', fetchImpl: geminiFetch([
                { parts: [{ functionCall: { name: 'search_entries', args: { query: CANARY } } }] },
                { parts: [{ text: `You wrote ${CANARY} [2026-11-10]` }] },
            ]) }),
            store, log: annotateSpan, allowedTiers: ['read', 'propose'],
        });
        await traceRequest(tracing, 'llm ask', { 'diary.feature': 'ask' }, () => ask({ question: CANARY, today: '2026-11-14' }));
        const list = await spans();

        const root = byName(list, 'llm ask');
        const tool = byName(list, 'execute_tool search_entries');
        expect(list.filter(s => s.name === 'generate_content gemini-test')).toHaveLength(2);
        expect(tool.parentSpanContext.spanId).toBe(root.spanContext().spanId);
        expect(tool.attributes).toMatchObject({ 'gen_ai.tool.name': 'search_entries', 'diary.tool.tier': 'read', 'diary.ok': true });
        expect(root.attributes).toMatchObject({ 'diary.outcome': 'ok', 'diary.tool_calls': 1, 'gen_ai.usage.input_tokens': 200 });
        expect(everything(list)).not.toContain('CANARY');
    });

    it('marks a failed model call as an error by class and status code, without its message', async () => {
        const handle = createHandler({
            model: 'gemini-test',
            callModel: createGeminiClient({ apiKey: 'k', fetchImpl: geminiFetch([{ status: 503 }]) }),
            log: annotateSpan,
        });
        await traceRequest(tracing, 'llm edit', {}, () => handle({ feature: 'edit', input: { selection: 'a', instruction: 'b' } })).catch(() => {});
        const list = await spans();

        const model = byName(list, 'generate_content gemini-test');
        expect(model.status.code).toBe(SpanStatusCode.ERROR);
        expect(model.status.message).toBeUndefined();
        expect(model.attributes).toMatchObject({ 'error.type': 'ModelError', 'http.response.status_code': 503, 'diary.retryable': true });
        expect(model.events).toEqual([]);
        expect(byName(list, 'llm edit').attributes['diary.outcome']).toBe('model_unavailable');
        expect(byName(list, 'llm edit').status.code).toBe(SpanStatusCode.ERROR);
    });

    it('does not count the caller\'s mistakes as server failures', async () => {
        const handle = createHandler({ model: 'gemini-test', callModel: async () => { throw new Error('not called'); }, log: annotateSpan });
        await traceRequest(tracing, 'llm edit', {}, () => handle({ feature: 'edit', input: { selection: CANARY } })).catch(() => {});
        const [root] = await spans();
        expect(root.attributes).toMatchObject({ 'diary.outcome': 'invalid_input', 'error.type': 'GatewayError' });
        expect(root.status.code).toBe(SpanStatusCode.UNSET);
        expect(everything([root])).not.toContain('CANARY');
    });

    it('traces MCP tool calls from Claude with their tier, never their arguments or results', async () => {
        const handler = createMcpHandler({
            authenticate: async () => ({ uid: 'joe', scopes: [SCOPES.READ, SCOPES.CHANGE] }),
            storeFor: () => ({ ...store, addTodo: async () => 't1' }),
            log: annotateSpan,
        });
        const client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL('https://diary.test/mcp'), {
            fetch: (url, init) => traceRequest(tracing, 'mcp mcp', {}, () => handler(new Request(url, init))),
        }));
        await client.callTool({ name: 'search_entries', arguments: { query: CANARY } });
        await client.close();
        const list = await spans();

        const tool = byName(list, 'execute_tool search_entries');
        expect(tool.attributes).toMatchObject({ 'gen_ai.tool.name': 'search_entries', 'diary.tool.tier': 'read', 'diary.ok': true });
        expect(list.find(s => s.spanContext().spanId === tool.parentSpanContext.spanId).name).toBe('mcp mcp');
        expect(everything(list)).not.toContain('CANARY');
    });

    it('copies only allowlisted log fields onto a span', async () => {
        await traceRequest(tracing, 'llm chat', {}, async () => annotateSpan({ feature: 'chat', outcome: 'ok', question: CANARY, inputSizes: { text: 12 }, tools: { [CANARY]: 1 } }));
        const [root] = await spans();
        expect(root.attributes).toEqual({ 'diary.feature': 'chat', 'diary.outcome': 'ok' });
    });

    it('scrubs spans from libraries that record error messages, like the Firestore client', async () => {
        // What the Firestore client does on a failed read: its own span, the message as the status,
        // an exception event and an event attribute holding the message.
        await traceRequest(tracing, 'llm ask', {}, async () => {
            const library = trace.getTracer('firestore');
            const span = library.startSpan('Query.Get', { attributes: { 'gcp.firestore.settings.database_id': '(default)', doc_count: 3 } });
            span.addEvent('Firestore.runQuery: Error.', { 'error.message': `NOT_FOUND users/u1/entries/${CANARY}`, transactional: false });
            span.recordException(new Error(`users/u1/entries/${CANARY}`));
            span.setStatus({ code: SpanStatusCode.ERROR, message: CANARY });
            span.end();
        });
        await withSpan('after', {}, async () => {});
        const list = await spans();

        const query = byName(list, 'Query.Get');
        expect(query.status).toEqual({ code: SpanStatusCode.ERROR });
        expect(query.attributes).toEqual({ 'gcp.firestore.settings.database_id': '(default)', doc_count: 3 });
        expect(query.events.map(e => [e.name, e.attributes])).toEqual([['Firestore.runQuery: Error.', { transactional: false }]]);
        expect(query.spanContext().spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(everything(list)).not.toContain('CANARY');
    });

    it('names routes from a fixed list', () => {
        expect(routeName('/mcp')).toBe('mcp');
        expect(routeName('/oauth/token')).toBe('oauth token');
        expect(routeName('/oauth/connections/revoke')).toBe('oauth connections revoke');
        expect(routeName('/.well-known/oauth-authorization-server')).toBe('well-known');
        expect(routeName(`/${CANARY}`)).toBe('other');
    });

    it('caches the service account token until shortly before it expires', async () => {
        let calls = 0;
        let time = 0;
        const getToken = createTokenSource({
            now: () => time,
            fetchImpl: async (url, init) => {
                calls += 1;
                expect(url).toContain('metadata.google.internal');
                expect(init.headers['Metadata-Flavor']).toBe('Google');
                return new Response(JSON.stringify({ access_token: `t${calls}`, expires_in: 3600 }));
            },
        });
        expect(await getToken()).toBe('t1');
        time = 3000 * 1000;
        expect(await getToken()).toBe('t1');
        time = 3550 * 1000;
        expect(await getToken()).toBe('t2');
    });
});
