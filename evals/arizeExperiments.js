// Uploads a prompt experiment to Arize: the feature's eval cases as a dataset, and each
// variant's results as an experiment on it, so Arize can compare the variants case by case.
//
//   node evals/arizeExperiments.js <experiment> <results dir>
//
// <results dir> holds one folder per variant, each with the results.json that evals/run.js
// wrote. Needs ARIZE_API_KEY and ARIZE_SPACE_ID; ARIZE_REGION picks the region (eu-west-1a).
// Only synthetic eval data is sent: the cases are invented, and so are the answers to them.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { EXPERIMENTS } from './experiments.js';
import { SUITES } from './suites.js';

export const arizeApiBase = (region = '') => (region ? `https://api.${region}.arize.com` : 'https://api.arize.com');

// api(method, path, body) -> parsed JSON; throws with Arize's own message on an error.
export const createArizeApi = ({ apiKey, region, fetchImpl = fetch }) => async (method, path, body) => {
    const response = await fetchImpl(`${arizeApiBase(region)}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${method} ${path.split('?')[0]} -> HTTP ${response.status}: ${parsed.detail || parsed.title || text.slice(0, 300)}`);
    return parsed;
};

// One dataset example per case. The name carries a hash of the cases, so editing a case makes
// a new dataset instead of comparing runs of different questions.
export const datasetFor = (feature) => {
    const suite = SUITES.find(s => s.feature === feature);
    const examples = suite.cases.map(testCase => ({
        case_id: testCase.id,
        feature,
        input: JSON.stringify(suite.input(testCase)),
    }));
    const hash = createHash('sha256').update(JSON.stringify(examples)).digest('hex').slice(0, 8);
    return { name: `joes-diary ${feature} cases ${hash}`, examples };
};

const findDataset = async (api, spaceId, name) => {
    const { datasets = [] } = await api('GET', `/v2/datasets?space_id=${encodeURIComponent(spaceId)}&name=${encodeURIComponent(name)}&limit=100`);
    return datasets.find(d => d.name === name) ?? null;
};

export const ensureDataset = async (api, spaceId, { name, examples }) => {
    const dataset = await findDataset(api, spaceId, name) ?? await api('POST', '/v2/datasets', { name, space_id: spaceId, examples });
    const { examples: stored = [] } = await api('GET', `/v2/datasets/${encodeURIComponent(dataset.id)}/examples?limit=500`);
    return { id: dataset.id, exampleIds: Object.fromEntries(stored.map(e => [e.case_id, e.id])) };
};

// Each result row becomes a run. Its checks and the judge become eval.<name>.* columns, the
// shape Arize reads as evaluator results, so they can be compared across variants.
export const runsFor = (results, exampleIds) => results
    .filter(row => exampleIds[row.caseId])
    .map(row => {
        const judge = row.judge && !row.judge.error ? row.judge : null;
        const scores = judge ? Object.values(judge.scores || {}) : [];
        const failed = (row.checks || []).filter(c => !c.pass && c.name !== 'judge').map(c => c.name);
        const run = {
            example_id: exampleIds[row.caseId],
            output: typeof row.output === 'string' ? row.output : JSON.stringify(row.output ?? null),
            case_id: row.caseId,
            repeat: row.run,
            outcome: row.outcome ?? 'none',
            latency_ms: row.latencyMs ?? null,
            input_tokens: row.inputTokens ?? null,
            output_tokens: row.outputTokens ?? null,
            prompt_version: row.promptVersion ?? null,
            model: row.modelVersion ?? null,
            'eval.passed.label': row.pass ? 'pass' : 'fail',
            'eval.passed.score': row.pass ? 1 : 0,
            'eval.passed.explanation': failed.length ? `failed: ${failed.join(', ')}` : 'all checks passed',
            ...(judge ? {
                'eval.judge.label': judge.pass ? 'pass' : 'fail',
                'eval.judge.score': Math.min(...scores),
                'eval.judge.explanation': String(judge.reason ?? '').slice(0, 2000),
                ...Object.fromEntries(Object.entries(judge.scores || {}).map(([k, v]) => [`eval.${k}.score`, v])),
            } : {}),
        };
        return Object.fromEntries(Object.entries(run).filter(([, v]) => v !== null && v !== undefined));
    });

// A one-table summary per variant for the run log: pass rate and judge means.
export const summaryTable = (variants) => {
    const criteria = [...new Set(variants.flatMap(v => v.results.flatMap(r => Object.keys(r.judge?.scores || {}))))];
    const mean = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : 'n/a');
    const rows = variants.map(({ name, results }) => {
        const pass = results.filter(r => r.pass).length;
        const cells = criteria.map(c => mean(results.map(r => r.judge?.scores?.[c]).filter(v => typeof v === 'number')));
        return `| ${name} | ${pass}/${results.length} | ${cells.join(' | ')} |`;
    });
    return [`| Variant | Passed | ${criteria.join(' | ')} |`, `|---|---|${criteria.map(() => '---').join('|')}|`, ...rows].join('\n');
};

export const uploadExperiment = async ({ api, spaceId, experimentName, resultsDir, stamp, log = console.log }) => {
    const experiment = EXPERIMENTS[experimentName];
    if (!experiment) throw new Error(`Unknown experiment ${experimentName}`);
    const dataset = await ensureDataset(api, spaceId, datasetFor(experiment.feature));
    log(`Dataset ${dataset.id} with ${Object.keys(dataset.exampleIds).length} examples`);
    const variants = [];
    for (const variant of experiment.variants) {
        const { results } = JSON.parse(readFileSync(`${resultsDir}/${variant.name}/results.json`, 'utf8'));
        variants.push({ name: variant.name, results });
        const runs = runsFor(results, dataset.exampleIds);
        const created = await api('POST', '/v2/experiments', { name: `${experimentName} / ${variant.name} / ${stamp}`, dataset_id: dataset.id, experiment_runs: runs });
        log(`Experiment ${created.name ?? variant.name}: ${runs.length} runs`);
    }
    return summaryTable(variants);
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const [experimentName, resultsDir] = process.argv.slice(2);
    const { ARIZE_API_KEY, ARIZE_SPACE_ID, ARIZE_REGION, GITHUB_RUN_ID } = process.env;
    if (!ARIZE_API_KEY || !ARIZE_SPACE_ID) throw new Error('ARIZE_API_KEY and ARIZE_SPACE_ID are needed');
    const table = await uploadExperiment({
        api: createArizeApi({ apiKey: ARIZE_API_KEY, region: ARIZE_REGION }),
        spaceId: ARIZE_SPACE_ID,
        experimentName,
        resultsDir,
        stamp: GITHUB_RUN_ID ? `gh-${GITHUB_RUN_ID}` : new Date().toISOString().slice(0, 16),
    });
    const markdown = `### Experiment ${experimentName}\n\n${table}\n\nCompare the runs side by side in Arize: Datasets, then the ${EXPERIMENTS[experimentName].feature} cases dataset, then Experiments.\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);
}
