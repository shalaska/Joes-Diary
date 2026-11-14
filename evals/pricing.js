// What an eval run costs. Every model call of a run (the models under test, the judge, the
// judge calibration, probes) goes through one meter, so the report shows the real total and
// not only the tokens of the model under test.
//
// Prices are EUR per million tokens, worked out from the Google Cloud billing report for
// November 2026 (cost divided by tokens, per SKU). Output includes thinking tokens, which are
// billed as output. Add a line when a new model is pinned; an unknown model is costed at the
// highest known price and flagged, so the total errs on the high side.
export const PRICES = {
    'gemini-4-hydrogen': { input: 1.35, output: 6.75 },
    'gemini-3.8-flash': { input: 0.68, output: 3.37 },
    'gemini-3.1-flash-lite': { input: 0.24, output: 1.43 },
};

const highest = (prices) => Object.values(prices).reduce((top, p) => (p.output > top.output ? p : top), { input: 0, output: 0 });

// Exact name, or the longest known name the model starts with (gemini-3.8-flash-001).
export const priceFor = (model, prices = PRICES) => {
    const name = Object.keys(prices).filter(known => String(model).startsWith(known)).sort((a, b) => b.length - a.length)[0];
    return name ? { ...prices[name], known: true } : { ...highest(prices), known: false };
};

const eur = (row, prices) => {
    const price = priceFor(row.model, prices);
    return (row.inputTokens * price.input + row.outputTokens * price.output) / 1e6;
};

export const createMeter = (prices = PRICES) => {
    const rows = new Map();
    const add = (purpose, model, usage = {}) => {
        const key = `${purpose}|${model}`;
        const row = rows.get(key) ?? { purpose, model, calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
        row.calls += 1;
        row.inputTokens += usage.inputTokens ?? 0;
        row.outputTokens += usage.outputTokens ?? 0;
        row.thinkingTokens += usage.thinkingTokens ?? 0;
        rows.set(key, row);
    };
    return {
        // Wraps a model client (createGeminiClient or createGeminiToolClient) so each call is counted.
        wrap: (call, purpose) => async (request) => {
            const result = await call(request);
            add(purpose, request.model, result.usage);
            return result;
        },
        rows: () => [...rows.values()].map(row => ({ ...row, eur: eur(row, prices), priceKnown: priceFor(row.model, prices).known })),
        totalEur: () => [...rows.values()].reduce((sum, row) => sum + eur(row, prices), 0),
    };
};

const money = (value) => `€${value.toFixed(value < 0.1 ? 3 : 2)}`;

export const costMarkdown = (meter, { limitEur = null, stopped = 0 } = {}) => {
    const rows = meter.rows().sort((a, b) => b.eur - a.eur);
    const unknown = rows.filter(r => !r.priceKnown).map(r => r.model);
    return [
        `### Cost of this run: about ${money(meter.totalEur())}`,
        '',
        '| Used for | Model | Calls | Tokens in | Tokens out (of which thinking) | Cost |',
        '| --- | --- | --- | --- | --- | --- |',
        ...rows.map(r => `| ${r.purpose} | \`${r.model}\`${r.priceKnown ? '' : ' (price unknown)'} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} (${r.thinkingTokens}) | ${money(r.eur)} |`),
        '',
        'Counted from the token usage of every call in this run, at the prices in `evals/pricing.js`. The bill is the source of truth and shows up some hours later.',
        ...(unknown.length ? ['', `No price is listed for ${[...new Set(unknown)].join(', ')}: costed at the highest known price.`] : []),
        ...(limitEur !== null ? ['', stopped
            ? `**Stopped at the spend limit of ${money(limitEur)}: ${stopped} case run(s) were not started.**`
            : `Spend limit for this run: ${money(limitEur)}.`] : []),
        '',
    ].join('\n');
};
