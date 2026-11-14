import { describe, expect, it } from 'vitest';
import { costMarkdown, createMeter, priceFor } from './pricing.js';

const PRICES = { 'big': { input: 1, output: 10 }, 'big-lite': { input: 0.1, output: 1 } };

describe('eval cost meter', () => {
    it('prices a model by its exact or longest matching name, and an unknown one at the highest price', () => {
        expect(priceFor('big-lite-001', PRICES)).toEqual({ input: 0.1, output: 1, known: true });
        expect(priceFor('big', PRICES)).toEqual({ input: 1, output: 10, known: true });
        expect(priceFor('other', PRICES)).toEqual({ input: 1, output: 10, known: false });
    });

    it('counts every call by purpose and model, thinking tokens included in output', async () => {
        const meter = createMeter(PRICES);
        const call = async ({ model }) => ({ text: model, usage: { inputTokens: 1_000_000, outputTokens: 100_000, thinkingTokens: 60_000 } });
        const tested = meter.wrap(call, 'under test');
        const judge = meter.wrap(call, 'judge');
        expect((await tested({ model: 'big' })).text).toBe('big');
        await tested({ model: 'big' });
        await judge({ model: 'big-lite' });
        expect(meter.rows()).toEqual([
            { purpose: 'under test', model: 'big', calls: 2, inputTokens: 2_000_000, outputTokens: 200_000, thinkingTokens: 120_000, eur: 4, priceKnown: true },
            { purpose: 'judge', model: 'big-lite', calls: 1, inputTokens: 1_000_000, outputTokens: 100_000, thinkingTokens: 60_000, eur: 0.2, priceKnown: true },
        ]);
        expect(meter.totalEur()).toBeCloseTo(4.2);
    });

    it('does not count a call that failed, and passes the error on', async () => {
        const meter = createMeter(PRICES);
        await expect(meter.wrap(async () => { throw new Error('HTTP 403'); }, 'judge')({ model: 'big' })).rejects.toThrow('HTTP 403');
        expect(meter.rows()).toEqual([]);
    });

    it('reports the total, the judge on its own line, unknown prices and a stop at the limit', async () => {
        const meter = createMeter(PRICES);
        await meter.wrap(async () => ({ usage: { inputTokens: 500_000, outputTokens: 0 } }), 'judge')({ model: 'mystery' });
        const text = costMarkdown(meter, { limitEur: 0.25, stopped: 3 });
        expect(text).toContain('Cost of this run: about €0.50');
        expect(text).toContain('| judge | `mystery` (price unknown) | 1 | 500000 | 0 (0) | €0.50 |');
        expect(text).toContain('No price is listed for mystery');
        expect(text).toContain('Stopped at the spend limit of €0.25: 3 case run(s) were not started.');
        expect(costMarkdown(meter, { limitEur: 1 })).toContain('Spend limit for this run: €1.00.');
    });
});
