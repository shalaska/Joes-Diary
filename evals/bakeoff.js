// Model bake-off: picks the stable Gemini models worth comparing, and turns one eval run
// per model into a single comparison table. The workflow (.github/workflows/bakeoff.yml)
// runs evals/run.js once per model with the same judge, then calls this file.
//
//   GEMINI_API_KEY=... node evals/bakeoff.js candidates <pinned-model>
//   node evals/bakeoff.js compare <dir-with-one-subdir-per-model>
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { listModels } from './models.js';

// Stable, general models only: no previews, dated snapshots, "latest" aliases, tts or image.
const STABLE = /^gemini-(\d+)\.(\d+)-(flash|flash-lite|pro)$/;

export const bakeoffCandidates = (names, pinned, perFamily = 2) => {
    const families = {};
    for (const name of names) {
        const match = STABLE.exec(name);
        if (!match) continue;
        (families[match[3]] ??= []).push({ name, version: [Number(match[1]), Number(match[2])] });
    }
    const picked = new Set(pinned ? [pinned] : []);
    for (const list of Object.values(families)) {
        list.sort((a, b) => (b.version[0] - a.version[0]) || (b.version[1] - a.version[1]));
        for (const { name } of list.slice(0, perFamily)) picked.add(name);
    }
    return [...picked];
};

const pct = (value) => (value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`);
const median = (values) => {
    const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// One row per model, from that model's results.json ({ summary, results }).
export const bakeoffRow = ({ summary, results }) => {
    const features = Object.values(summary.byFeature);
    const scores = features.flatMap(f => Object.values(f.meanScores ?? {}));
    const ok = results.filter(r => r.outcome === 'ok');
    return {
        model: summary.model,
        servedVersion: summary.servedVersion,
        runs: summary.overall.runs,
        passRate: summary.overall.passRate,
        byFeature: Object.fromEntries(Object.entries(summary.byFeature).map(([name, f]) => [name, f.passRate])),
        meanJudgeScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
        gatewayErrors: results.length - ok.length,
        medianLatencyMs: median(ok.map(r => r.latencyMs)),
        p90LatencyMs: (() => {
            const sorted = ok.map(r => r.latencyMs).filter(v => typeof v === 'number').sort((a, b) => a - b);
            return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null;
        })(),
        inputTokens: results.reduce((a, r) => a + (r.inputTokens ?? 0), 0),
        outputTokens: results.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
    };
};

export const bakeoffMarkdown = (rows, { judgeModel, repeats, pinned }) => {
    const features = [...new Set(rows.flatMap(r => Object.keys(r.byFeature)))];
    const sorted = [...rows].sort((a, b) => (b.passRate - a.passRate) || ((b.meanJudgeScore ?? 0) - (a.meanJudgeScore ?? 0)));
    return [
        '## Model bake-off',
        '',
        `Every case run ${repeats} times per model through the production gateway. Judge: \`${judgeModel}\` for every model. Pinned today: \`${pinned}\`.`,
        '',
        `| Model | All checks passed | ${features.join(' | ')} | Mean judge score | Errors | Median / p90 latency (ms) | Tokens in / out |`,
        `| --- | --- | ${features.map(() => '---').join(' | ')} | --- | --- | --- | --- |`,
        ...sorted.map(r => `| \`${r.model}\`${r.model === pinned ? ' (pinned)' : ''} | ${pct(r.passRate)} (${r.runs} runs) | ${features.map(f => pct(r.byFeature[f])).join(' | ')} | ${r.meanJudgeScore ?? 'n/a'} | ${r.gatewayErrors} | ${r.medianLatencyMs ?? '?'} / ${r.p90LatencyMs ?? '?'} | ${r.inputTokens} / ${r.outputTokens} |`),
        '',
        'Errors are calls that failed or returned output the gateway rejected. All inputs are synthetic.',
        '',
    ].join('\n');
};

const main = async () => {
    const [command, arg] = process.argv.slice(2);
    if (command === 'candidates') {
        const names = await listModels(process.env.GEMINI_API_KEY);
        console.error(`Models with generateContent: ${names.join(', ')}`);
        console.log(bakeoffCandidates(names, arg).join(','));
        return;
    }
    if (command === 'compare') {
        const rows = readdirSync(arg, { withFileTypes: true })
            .filter(d => d.isDirectory() && existsSync(`${arg}/${d.name}/results.json`))
            .map(d => bakeoffRow(JSON.parse(readFileSync(`${arg}/${d.name}/results.json`, 'utf8'))));
        const markdown = bakeoffMarkdown(rows, {
            judgeModel: process.env.EVAL_JUDGE_MODEL,
            repeats: process.env.EVAL_REPEATS,
            pinned: process.env.PINNED_MODEL,
        });
        writeFileSync(`${arg}/bakeoff.md`, markdown);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
        console.log(markdown);
        return;
    }
    throw new Error('Usage: bakeoff.js candidates <pinned> | compare <dir>');
};

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
