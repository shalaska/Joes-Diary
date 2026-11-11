import { describe, expect, it } from 'vitest';
import { bakeoffCandidates, bakeoffMarkdown, bakeoffRow } from './bakeoff.js';

describe('bakeoffCandidates', () => {
    it('keeps the newest two stable models per family plus the pinned one', () => {
        const names = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite',
            'gemini-3.9-flash-preview', 'gemini-2.5-pro', 'gemini-flash-latest', 'gemini-3.8-flash-tts', 'gemma-3-27b-it'];
        expect(bakeoffCandidates(names, 'gemini-2.5-flash').sort()).toEqual(
            ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite'].sort());
    });
});

describe('bakeoff report', () => {
    const run = (model, passes, latency) => ({
        summary: {
            model, servedVersion: model, overall: { runs: passes.length, passRate: passes.filter(Boolean).length / passes.length },
            byFeature: { chat: { passRate: passes.filter(Boolean).length / passes.length, meanScores: { tone: 4, grounded: 5 } } },
        },
        results: passes.map((pass, i) => ({ pass, outcome: i === 0 && !pass ? 'model_error' : 'ok', latencyMs: latency + i, inputTokens: 10, outputTokens: 2 })),
    });

    it('summarises one model', () => {
        const row = bakeoffRow(run('m1', [false, true, true, true], 100));
        expect(row).toMatchObject({ model: 'm1', passRate: 0.75, meanJudgeScore: 4.5, gatewayErrors: 1, medianLatencyMs: 102, inputTokens: 40, outputTokens: 8 });
    });

    it('ranks models by pass rate and marks the pinned one', () => {
        const md = bakeoffMarkdown([bakeoffRow(run('slow', [true, false], 50)), bakeoffRow(run('best', [true, true], 90))], { judgeModel: 'j', repeats: 3, pinned: 'best' });
        expect(md.indexOf('`best` (pinned)')).toBeGreaterThan(-1);
        expect(md.indexOf('`best`')).toBeLessThan(md.indexOf('`slow`'));
    });
});
