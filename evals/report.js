// Turns eval results into per-feature numbers and a Markdown report.
const pct = (value) => `${Math.round(value * 100)}%`;
const median = (values) => {
    const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const summarise = (results, { model, repeats }) => {
    const features = {};
    for (const result of results) {
        const f = (features[result.feature] ??= { runs: 0, passed: 0, checks: 0, checksPassed: 0, latencies: [], inputTokens: 0, outputTokens: 0 });
        f.runs += 1;
        f.passed += result.pass ? 1 : 0;
        f.checks += result.checks.length;
        f.checksPassed += result.checks.filter(c => c.pass).length;
        f.latencies.push(result.latencyMs);
        f.inputTokens += result.inputTokens ?? 0;
        f.outputTokens += result.outputTokens ?? 0;
    }
    const byFeature = Object.fromEntries(Object.entries(features).map(([name, f]) => [name, {
        runs: f.runs,
        passRate: f.passed / f.runs,
        checkPassRate: f.checksPassed / f.checks,
        medianLatencyMs: median(f.latencies),
        inputTokens: f.inputTokens,
        outputTokens: f.outputTokens,
    }]));
    const runs = results.length;
    return {
        model,
        repeats,
        servedVersion: results.find(r => r.modelVersion)?.modelVersion ?? null,
        overall: { runs, passRate: runs ? results.filter(r => r.pass).length / runs : 0 },
        byFeature,
    };
};

export const toMarkdown = (summary, results) => {
    const lines = [
        `## Evals: \`${summary.model}\``,
        '',
        `${summary.overall.runs} runs, ${pct(summary.overall.passRate)} passed every check. Served version: ${summary.servedVersion ?? 'unknown'}.`,
        '',
        '| Feature | Cases passed | Checks passed | Median latency (ms) | Tokens in / out |',
        '| --- | --- | --- | --- | --- |',
        ...Object.entries(summary.byFeature).map(([name, f]) => `| ${name} | ${pct(f.passRate)} (${Math.round(f.passRate * f.runs)}/${f.runs}) | ${pct(f.checkPassRate)} | ${f.medianLatencyMs ?? '?'} | ${f.inputTokens} / ${f.outputTokens} |`),
        '',
    ];
    const failures = results.filter(r => !r.pass);
    if (failures.length) {
        lines.push('### Failed checks', '', '| Feature | Case | Check | Detail |', '| --- | --- | --- | --- |');
        for (const result of failures) {
            for (const c of result.checks.filter(c => !c.pass)) {
                lines.push(`| ${result.feature} | ${result.caseId}${summary.repeats > 1 ? ` #${result.run}` : ''} | ${c.name} | ${String(c.detail).replace(/\|/g, '/').slice(0, 160)} |`);
            }
        }
        lines.push('');
    }
    lines.push('All inputs are synthetic. See `evals/cases/`.', '');
    return lines.join('\n');
};
