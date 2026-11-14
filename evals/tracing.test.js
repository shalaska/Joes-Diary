import { describe, expect, it } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { arizeHeaders, createEvalTracing, PROJECT, traceCase, traceJudge, traceModel } from './tracing.js';

const fakeModel = (reply) => async () => ({ text: reply, usage: { inputTokens: 120, outputTokens: 30, thinkingTokens: 10 }, modelVersion: 'gemini-test-001' });

const setup = () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createEvalTracing({ exporter, env: { GITHUB_RUN_ID: '42' } });
    const byName = () => Object.fromEntries(exporter.getFinishedSpans().map(s => [s.name, s]));
    return { exporter, tracing, byName };
};

describe('eval tracing', () => {
    it('stays off without the Arize secrets, so local runs send nothing', async () => {
        const tracing = createEvalTracing({ env: {} });
        expect(tracing.enabled).toBe(false);
        expect(await traceCase(tracing, { feature: 'edit', caseId: 'c1', run: 1, input: {} }, async () => ({ pass: true }))).toEqual({ pass: true });
    });

    it('sends the space id and key in both spellings Arize documents', () => {
        expect(arizeHeaders({ ARIZE_API_KEY: 'k', ARIZE_SPACE_ID: 's' })).toEqual({ space_id: 's', api_key: 'k', 'arize-space-id': 's', 'arize-api-key': 'k' });
    });

    it('makes each case a root span with its model call, checks and judge nested under it', async () => {
        const { tracing, byName } = setup();
        const callModel = traceModel(fakeModel('A tidy sentence.'), tracing.tracer, 'under test');
        const callJudge = traceModel(fakeModel('{"pass":true}'), tracing.tracer, 'judge');

        await traceCase(tracing, { feature: 'edit', caseId: 'tidy-1', run: 1, input: { selection: 'a messy sentence' }, model: 'gemini-test' }, async () => {
            const answer = await callModel({ model: 'gemini-test', prompt: 'Tidy: a messy sentence' });
            const judged = await traceJudge(tracing, async () => {
                await callJudge({ model: 'gemini-judge', prompt: 'Judge it' });
                return { pass: true, scores: { grounded: 5, tone: 4 }, reason: 'Fine.' };
            });
            return { pass: true, outcome: 'ok', output: answer.text, checks: [{ name: 'keeps_meaning', pass: true, detail: '' }, { name: 'judge', pass: judged.pass }], judge: judged };
        });
        const spans = byName();
        await new Promise(resolve => setTimeout(resolve, 0)); // the in-memory exporter reports back on the next tick
        expect(await tracing.shutdown()).toMatch(/5 spans sent/);

        const root = spans['eval edit/tidy-1'];
        expect(root.parentSpanContext).toBeUndefined();
        expect(root.attributes).toMatchObject({
            'openinference.span.kind': 'CHAIN', 'session.id': 'gh-42', 'eval.pass': true, 'output.value': 'A tidy sentence.',
        });
        expect(root.resource.attributes['openinference.project.name']).toBe(PROJECT);

        const llm = spans['gemini under test'];
        expect(llm.parentSpanContext.spanId).toBe(root.spanContext().spanId);
        expect(llm.attributes).toMatchObject({
            'openinference.span.kind': 'LLM', 'llm.model_name': 'gemini-test', 'llm.token_count.prompt': 120,
            'llm.token_count.completion': 30, 'llm.token_count.total': 150, 'input.value': 'Tidy: a messy sentence',
        });

        const check = spans['check keeps_meaning'];
        expect(check.parentSpanContext.spanId).toBe(root.spanContext().spanId);
        expect(check.attributes).toMatchObject({ 'openinference.span.kind': 'EVALUATOR', 'evaluation.label': 'pass', 'evaluation.score': 1 });
        expect(spans['check judge']).toBeUndefined();

        const judge = spans.judge;
        expect(judge.attributes).toMatchObject({ 'evaluation.label': 'pass', 'evaluation.score': 4, 'judge.tone': 4 });
        expect(spans['gemini judge'].parentSpanContext.spanId).toBe(judge.spanContext().spanId);
    });

    it('marks a failed case and a failed model call as errors, and still returns the row', async () => {
        const { tracing, byName } = setup();
        const broken = traceModel(async () => { throw new Error('Model returned HTTP 500'); }, tracing.tracer, 'under test');
        const row = await traceCase(tracing, { feature: 'ask', caseId: 'q1', run: 2, input: { question: 'x' } }, async () => {
            await broken({ model: 'gemini-test', system: 's', contents: [] }).catch(() => {});
            return { pass: false, outcome: 'model_error', output: null, checks: [{ name: 'gateway_ok', pass: false, detail: 'model_error' }] };
        });
        const spans = byName();
        await tracing.shutdown();
        expect(row.pass).toBe(false);
        expect(spans['eval ask/q1'].attributes['openinference.span.kind']).toBe('AGENT');
        expect(spans['eval ask/q1'].status.code).toBe(2);
        expect(spans['gemini under test'].status).toMatchObject({ code: 2, message: 'Model returned HTTP 500' });
        expect(spans['check gateway_ok'].attributes['evaluation.label']).toBe('fail');
    });
});
