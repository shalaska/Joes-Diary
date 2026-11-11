// The eval gate: compares a run's summary with the stored baseline (evals/baseline.json)
// and lists the regressions that should block a merge. Tolerances come from the noise
// check (every case run several times on an unchanged prompt and model), so ordinary
// run-to-run variation does not fail a PR, but a real drop does.

export const DEFAULT_TOLERANCES = {
    passRate: 0.1, // a feature may lose at most 10 points of cases passing
    judgeMean: 0.3, // and at most 0.3 on any judge criterion (1-5 scale)
};

const round = (value) => Math.round(value * 100) / 100;

export const compareToBaseline = (summary, baseline, tolerances = DEFAULT_TOLERANCES) => {
    const regressions = [];
    for (const [feature, base] of Object.entries(baseline.features)) {
        const now = summary.byFeature[feature];
        if (!now) {
            regressions.push({ feature, metric: 'missing', baseline: null, now: null, detail: 'feature not run' });
            continue;
        }
        if (now.passRate < base.passRate - tolerances.passRate) {
            regressions.push({ feature, metric: 'cases passing', baseline: round(base.passRate), now: round(now.passRate) });
        }
        for (const [criterion, baseMean] of Object.entries(base.judgeMeans ?? {})) {
            const nowMean = now.meanScores?.[criterion];
            if (nowMean === undefined) continue; // judge unavailable this run: reported, not gated
            if (nowMean < baseMean - tolerances.judgeMean) {
                regressions.push({ feature, metric: `judge ${criterion}`, baseline: baseMean, now: nowMean });
            }
        }
    }
    return regressions;
};

export const toBaseline = (summary, { promptVersions }) => ({
    model: summary.model,
    judgeModel: summary.judgeModel,
    repeats: summary.repeats,
    promptVersions,
    features: Object.fromEntries(Object.entries(summary.byFeature).map(([name, f]) => [name, {
        passRate: round(f.passRate),
        judgeMeans: f.meanScores,
    }])),
});

export const gateMarkdown = (regressions, baseline) => {
    if (regressions.length === 0) {
        return `### Gate: passed\n\nNo feature dropped beyond the noise tolerance against the baseline (\`${baseline.model}\`, ${baseline.repeats} runs per case).\n`;
    }
    return [
        '### Gate: FAILED',
        '',
        `Compared with the baseline (\`${baseline.model}\`, ${baseline.repeats} runs per case):`,
        '',
        '| Feature | Metric | Baseline | Now |',
        '| --- | --- | --- | --- |',
        ...regressions.map(r => `| ${r.feature} | ${r.metric} | ${r.baseline ?? ''} | ${r.now ?? r.detail} |`),
        '',
        'If the drop is intended (for example a deliberate trade-off), update `evals/baseline.json` in the same PR and say why.',
        '',
    ].join('\n');
};
