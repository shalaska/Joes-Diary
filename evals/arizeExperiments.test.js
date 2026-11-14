import { describe, expect, it } from 'vitest';
import { arizeApiBase, createArizeApi, datasetFor, runsFor, summaryTable, uploadExperiment } from './arizeExperiments.js';
import { EXPERIMENTS, findVariant } from './experiments.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const row = (caseId, pass, scores, extra = {}) => ({
    feature: 'chat', caseId, run: 1, outcome: 'ok', latencyMs: 900, inputTokens: 400, outputTokens: 60,
    promptVersion: 'chat-v3', modelVersion: 'gemini-test', pass,
    checks: [{ name: 'json_shape', pass: true }, { name: 'no_stock_opener', pass }, { name: 'judge', pass }],
    output: { type: 'question', content: 'What made Tuesday different?' },
    judge: { pass, scores, reason: 'Specific and short.' }, ...extra,
});

// A fake Arize: datasets by name, examples with ids, experiments recorded.
const fakeArize = () => {
    const datasets = [];
    const experiments = [];
    const api = async (method, path, body) => {
        if (method === 'GET' && path.startsWith('/v2/datasets?')) {
            const name = decodeURIComponent(/name=([^&]+)/.exec(path)[1]);
            return { datasets: datasets.filter(d => d.name.includes(name)) };
        }
        if (method === 'POST' && path === '/v2/datasets') {
            const d = { id: `ds${datasets.length + 1}`, name: body.name, examples: body.examples.map((e, i) => ({ ...e, id: `ex${i + 1}` })) };
            datasets.push(d);
            return { id: d.id, name: d.name };
        }
        if (method === 'GET' && path.includes('/examples')) {
            const id = decodeURIComponent(path.split('/')[3]);
            return { examples: datasets.find(d => d.id === id).examples };
        }
        if (method === 'POST' && path === '/v2/experiments') { experiments.push(body); return { id: `exp${experiments.length}`, name: body.name }; }
        throw new Error(`unexpected ${method} ${path}`);
    };
    return { api, datasets, experiments };
};

describe('prompt experiments', () => {
    it('defines variants that change only the input, and finds them by name', () => {
        const { experiment, variant } = findVariant('chat-tone', 'chat-v4-tone');
        expect(experiment.feature).toBe('chat');
        expect(variant.input({ text: 'hi' })).toEqual({ text: 'hi', systemPrompt: expect.stringContaining('match their register') });
        expect(findVariant('chat-tone', 'chat-v3-live').variant.input({ text: 'hi' })).toEqual({ text: 'hi' });
        expect(() => findVariant('chat-tone', 'nope')).toThrow(/Unknown variant/);
        expect(() => findVariant('nope', 'x')).toThrow(/Unknown experiment/);
    });

    it('keeps the live prompt\'s JSON instructions in the candidate', () => {
        const prompt = EXPERIMENTS['chat-tone'].variants[1].input({ text: 'x' }).systemPrompt;
        expect(prompt).toContain('Respond with a JSON object');
        expect(prompt).toContain('"type": "question", "suggestion" or "expansion"');
    });

    it('names a dataset after a hash of its cases, so changed cases make a new one', () => {
        const a = datasetFor('chat');
        expect(a.name).toMatch(/^joes-diary chat cases [0-9a-f]{8}$/);
        expect(datasetFor('chat').name).toBe(a.name);
        expect(a.examples[0]).toEqual({ case_id: expect.any(String), feature: 'chat', input: expect.stringContaining('"text"') });
    });

    it('turns result rows into runs with eval columns for checks and judge', () => {
        const [run] = runsFor([row('c1', false, { tone: 3, grounded: 5 })], { c1: 'ex1' });
        expect(run).toMatchObject({
            example_id: 'ex1', case_id: 'c1', output: JSON.stringify({ type: 'question', content: 'What made Tuesday different?' }),
            'eval.passed.label': 'fail', 'eval.passed.score': 0, 'eval.passed.explanation': 'failed: no_stock_opener',
            'eval.judge.label': 'fail', 'eval.judge.score': 3, 'eval.tone.score': 3, 'eval.grounded.score': 5,
        });
        const [noJudge] = runsFor([row('c1', true, {}, { judge: { error: 'timeout' }, latencyMs: null })], { c1: 'ex1' });
        expect(noJudge).not.toHaveProperty('eval.judge.label');
        expect(noJudge).not.toHaveProperty('latency_ms');
        expect(runsFor([row('unknown', true, {})], { c1: 'ex1' })).toEqual([]);
    });

    it('creates the dataset once and one experiment per variant', async () => {
        const arize = fakeArize();
        const dir = join(tmpdir(), `exp-${Date.now()}`);
        const cases = datasetFor('chat').examples.map(e => e.case_id);
        for (const [name, tone] of [['chat-v3-live', 4], ['chat-v4-tone', 5]]) {
            mkdirSync(join(dir, name), { recursive: true });
            writeFileSync(join(dir, name, 'results.json'), JSON.stringify({ results: cases.map(c => row(c, true, { tone })) }));
        }
        const table = await uploadExperiment({ api: arize.api, spaceId: 'space', experimentName: 'chat-tone', resultsDir: dir, stamp: 'gh-1', log: () => {} });
        await uploadExperiment({ api: arize.api, spaceId: 'space', experimentName: 'chat-tone', resultsDir: dir, stamp: 'gh-2', log: () => {} });

        expect(arize.datasets).toHaveLength(1);
        expect(arize.experiments.map(e => e.name)).toEqual(['chat-tone / chat-v3-live / gh-1', 'chat-tone / chat-v4-tone / gh-1', 'chat-tone / chat-v3-live / gh-2', 'chat-tone / chat-v4-tone / gh-2']);
        expect(arize.experiments[0].experiment_runs).toHaveLength(cases.length);
        expect(table).toContain('| chat-v4-tone |');
        expect(table).toContain('5.00');
    });

    it('summarises pass rate and judge means per variant', () => {
        const table = summaryTable([{ name: 'a', results: [row('c1', true, { tone: 4 }), row('c2', false, { tone: 2 })] }]);
        expect(table).toContain('| a | 1/2 | 3.00 |');
    });

    it('calls the regional API with a bearer key and reports Arize\'s error', async () => {
        expect(arizeApiBase('eu-west-1a')).toBe('https://api.eu-west-1a.arize.com');
        let seen;
        const api = createArizeApi({ apiKey: 'k', region: 'eu-west-1a', fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ detail: 'invalid space' }), { status: 400 }); } });
        await expect(api('POST', '/v2/datasets', {})).rejects.toThrow('HTTP 400: invalid space');
        expect(seen.url).toBe('https://api.eu-west-1a.arize.com/v2/datasets');
        expect(seen.init.headers.Authorization).toBe('Bearer k');
    });
});
