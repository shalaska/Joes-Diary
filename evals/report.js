// Turns eval results into per-feature numbers and a Markdown report.
const cell = (value, max) => String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, max);
const pct = (value) => `${Math.round(value * 100)}%`;
const median = (values) => {
    const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export const summarise = (results, { model, repeats, judgeModel = null }) => {
    const features = {};
    for (const result of results) {
        const f = (features[result.feature] ??= { runs: 0, passed: 0, checks: 0, checksPassed: 0, latencies: [], inputTokens: 0, outputTokens: 0, judged: 0, judgePassed: 0, scores: {} });
        f.runs += 1;
        f.passed += result.pass ? 1 : 0;
        f.checks += result.checks.length;
        f.checksPassed += result.checks.filter(c => c.pass).length;
        f.latencies.push(result.latencyMs);
        f.inputTokens += result.inputTokens ?? 0;
        f.outputTokens += result.outputTokens ?? 0;
        if (result.judge?.error) f.judgeErrors = (f.judgeErrors ?? 0) + 1;
        if (result.judge && !result.judge.error) {
            f.judged += 1;
            f.judgePassed += result.judge.pass ? 1 : 0;
            for (const [name, score] of Object.entries(result.judge.scores ?? {})) (f.scores[name] ??= []).push(score);
        }
    }
    const byFeature = Object.fromEntries(Object.entries(features).map(([name, f]) => [name, {
        runs: f.runs,
        passRate: f.passed / f.runs,
        checkPassRate: f.checksPassed / f.checks,
        medianLatencyMs: median(f.latencies),
        inputTokens: f.inputTokens,
        outputTokens: f.outputTokens,
        judgePassRate: f.judged ? f.judgePassed / f.judged : null,
        judgeErrors: f.judgeErrors ?? 0,
        meanScores: Object.fromEntries(Object.entries(f.scores).map(([name, list]) => [name, Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10])),
    }]));
    const runs = results.length;
    return {
        model,
        repeats,
        judgeModel,
        servedVersion: results.find(r => r.modelVersion)?.modelVersion ?? null,
        overall: { runs, passRate: runs ? results.filter(r => r.pass).length / runs : 0 },
        byFeature,
    };
};

export const toMarkdown = (summary, results) => {
    const lines = [
        `## Evals: \`${summary.model}\``,
        '',
        `${summary.overall.runs} runs, ${pct(summary.overall.passRate)} passed every check. Served version: ${summary.servedVersion ?? 'unknown'}.`
            + (summary.judgeModel ? ` Judge: \`${summary.judgeModel}\`.` : ' Code graders only.'),
        '',
        '| Feature | Cases passed | Checks passed | Judge passed | Mean judge scores (1-5) | Median latency (ms) | Tokens in / out |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...Object.entries(summary.byFeature).map(([name, f]) => `| ${name} | ${pct(f.passRate)} (${Math.round(f.passRate * f.runs)}/${f.runs}) | ${pct(f.checkPassRate)} | ${f.judgePassRate === null ? 'n/a' : pct(f.judgePassRate)}${f.judgeErrors ? ` (${f.judgeErrors} judge errors)` : ''} | ${Object.entries(f.meanScores).map(([k, v]) => `${k} ${v}`).join(', ') || 'n/a'} | ${f.medianLatencyMs ?? '?'} | ${f.inputTokens} / ${f.outputTokens} |`),
        '',
    ];
    const failures = results.filter(r => !r.pass);
    if (failures.length) {
        lines.push('### Failed checks', '', '| Feature | Case | Check | Detail |', '| --- | --- | --- | --- |');
        for (const result of failures) {
            for (const c of result.checks.filter(c => !c.pass)) {
                lines.push(`| ${result.feature} | ${result.caseId}${summary.repeats > 1 ? ` #${result.run}` : ''} | ${c.name} | ${cell(c.detail, 220)} |`);
            }
        }
        lines.push('', '<details><summary>Outputs of failed cases (synthetic input)</summary>', '');
        for (const result of failures) {
            lines.push(`**${result.feature} / ${result.caseId}**`, '', '```', String(typeof result.output === 'string' ? result.output : JSON.stringify(result.output)).slice(0, 600), '```', '');
        }
        lines.push('</details>', '');
    }
    lines.push('All inputs are synthetic. See `evals/cases/`.', '');
    return lines.join('\n');
};

export const calibrationMarkdown = (judgeModel, rows) => {
    const scored = rows.filter(r => r.judged !== 'error');
    const agree = scored.filter(r => r.judged === r.label).length;
    const falsePass = scored.filter(r => r.label === 'fail' && r.judged === 'pass').length;
    const falseFail = scored.filter(r => r.label === 'pass' && r.judged === 'fail').length;
    return [
        `## Judge calibration: \`${judgeModel}\``,
        '',
        `Agrees with the hand labels on ${agree}/${scored.length} items (${scored.length ? pct(agree / scored.length) : 'n/a'}). `
            + `Let through ${falsePass} bad answer(s), failed ${falseFail} good one(s)${rows.length - scored.length ? `, ${rows.length - scored.length} error(s)` : ''}.`,
        '',
        '| Item | Human | Judge | Scores | Judge reason |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(r => `| ${r.id} | ${r.label} | ${r.judged}${r.judged === r.label ? '' : ' ✗'} | ${Object.entries(r.scores ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')} | ${cell(r.reason, 160)} |`),
        '',
    ].join('\n');
};
