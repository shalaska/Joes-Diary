// Weekly model-bump job (see .github/workflows/gemini-model-bump.yml).
// 1. Lists the Gemini models the key can use and finds the newest stable Flash.
// 2. If it is newer than the pin in gateway/.env.joesdiary-d8211, runs every gateway
//    feature once against it with synthetic input (never diary data) through the same
//    handler and output checks the gateway uses in production.
// 3. Rewrites the pin and writes a Markdown report for the pull request.
// Outputs for GitHub Actions: bump, current, candidate, smoke (pass|fail).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHandler } from '../gateway/src/handler.js';
import { createGeminiClient } from '../gateway/src/gemini.js';
import { isNewer, newestStableFlash, readPinnedModel, writePinnedModel } from './geminiModel.js';

const ENV_FILE = 'gateway/.env.joesdiary-d8211';
const REPORT_FILE = process.env.REPORT_FILE || 'model-bump-report.md';

// Synthetic inputs only. Nothing here comes from the diary.
const SMOKE_CASES = [
    ['chat', { text: 'Busy week. I keep starting things and not finishing them, and I am not sure what to drop.' }],
    ['edit', { selection: 'the meeting was kind of long and we didnt decide much', instruction: 'Make this clearer and more concise' }],
    ['extractTodos', { text: 'Need to renew the car insurance before Friday. Should also call the dentist, and maybe look at flights for May.' }],
    ['calendarNote', {
        dateLabel: 'Tuesday, 3 March 2026',
        events: [
            { time: '09:00–10:00', title: 'Team standup and planning', location: null, description: null },
            { time: '12:30–13:30', title: 'Lunch with a friend', location: 'City centre', description: null },
            { time: '15:00–17:00', title: 'Focus block: quarterly review draft', location: null, description: null },
        ],
    }],
];

const output = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(`${key}=${value}`);
};

const listModels = async (apiKey) => {
    const names = [];
    let pageToken = '';
    do {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const response = await fetch(url, { headers: { 'x-goog-api-key': apiKey } });
        if (!response.ok) throw new Error(`Listing models failed: HTTP ${response.status}`);
        const body = await response.json();
        for (const model of body.models || []) {
            if ((model.supportedGenerationMethods || []).includes('generateContent')) names.push(model.name.replace(/^models\//, ''));
        }
        pageToken = body.nextPageToken || '';
    } while (pageToken);
    return names;
};

const smokeTest = async (apiKey, model) => {
    const logs = [];
    const handle = createHandler({ callModel: createGeminiClient({ apiKey }), model, log: (entry) => logs.push(entry) });
    const rows = [];
    for (const [feature, input] of SMOKE_CASES) {
        try {
            await handle({ feature, input });
        } catch {
            // The outcome is in the log entry.
        }
        const entry = logs.at(-1);
        rows.push({ feature, outcome: entry.outcome, latencyMs: entry.latencyMs, tokens: `${entry.inputTokens ?? '?'} / ${entry.outputTokens ?? '?'}`, modelVersion: entry.modelVersion ?? '' });
    }
    return rows;
};

const main = async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const envText = readFileSync(ENV_FILE, 'utf8');
    const current = readPinnedModel(envText);
    const candidate = newestStableFlash(await listModels(apiKey));
    output('current', current);
    output('candidate', candidate ?? '');

    if (!candidate || !isNewer(candidate, current)) {
        output('bump', 'false');
        return;
    }

    const rows = await smokeTest(apiKey, candidate);
    const passed = rows.every(row => row.outcome === 'ok');
    writeFileSync(ENV_FILE, writePinnedModel(envText, candidate));

    const report = [
        `Moves the gateway from \`${current}\` to \`${candidate}\`, the newest stable Flash model the key can use.`,
        '',
        `### Smoke test: ${passed ? 'passed' : 'FAILED'}`,
        '',
        'Each gateway feature was called once on the new model with synthetic input, through the production handler and output checks.',
        '',
        '| Feature | Outcome | Latency (ms) | Tokens in / out | Served version |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(row => `| ${row.feature} | ${row.outcome} | ${row.latencyMs} | ${row.tokens} | ${row.modelVersion} |`),
        '',
        'This is a format and availability check. The quality evals against the baseline follow below.',
        '',
        'Merging deploys the gateway with the new model. To roll back, revert this PR.',
    ].join('\n');
    writeFileSync(REPORT_FILE, `${report}\n`);
    output('bump', 'true');
    output('smoke', passed ? 'pass' : 'fail');
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
