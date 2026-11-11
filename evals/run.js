// Runs every eval suite against a Gemini model through the production gateway handler
// (same prompts, schemas and output checks as live), grades each answer with the code
// graders, and writes a JSON result file and a Markdown report.
//
//   GEMINI_API_KEY=... node evals/run.js                 # the pinned model
//   GEMINI_API_KEY=... EVAL_MODEL=gemini-x.y-flash node evals/run.js
//
// Options (env): EVAL_MODEL, EVAL_FEATURES (comma list), EVAL_REPEATS (default 1),
// EVAL_OUT (default eval-results), EVAL_MIN_PASS_RATE (fail the run below this, 0-1).
// Inputs are synthetic. Nothing here reads or sends diary data.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHandler } from '../gateway/src/handler.js';
import { createGeminiClient } from '../gateway/src/gemini.js';
import { readPinnedModel } from '../scripts/geminiModel.js';
import { SUITES } from './suites.js';
import { summarise, toMarkdown } from './report.js';

const CONCURRENCY = 4;

const runPool = async (jobs, limit) => {
    const results = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const index = next++;
            results[index] = await jobs[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
};

const main = async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    const model = process.env.EVAL_MODEL || readPinnedModel(readFileSync('gateway/.env.joesdiary-d8211', 'utf8'));
    const repeats = Number(process.env.EVAL_REPEATS || 1);
    const only = (process.env.EVAL_FEATURES || '').split(',').map(s => s.trim()).filter(Boolean);
    const outDir = process.env.EVAL_OUT || 'eval-results';

    const callModel = createGeminiClient({ apiKey });
    const suites = SUITES.filter(suite => only.length === 0 || only.includes(suite.feature));
    const jobs = [];
    for (const suite of suites) {
        for (const testCase of suite.cases) {
            for (let run = 1; run <= repeats; run++) {
                jobs.push(async () => {
                    let logEntry = null;
                    const handle = createHandler({ callModel, model, log: (entry) => { logEntry = entry; } });
                    let output = null;
                    try {
                        output = (await handle({ feature: suite.feature, input: suite.input(testCase) })).output;
                    } catch {
                        // The outcome is in the log entry.
                    }
                    const checks = logEntry?.outcome === 'ok'
                        ? suite.grade(testCase, output)
                        : [{ name: 'gateway_ok', pass: false, detail: logEntry?.outcome ?? 'no log' }];
                    return {
                        feature: suite.feature, caseId: testCase.id, run,
                        outcome: logEntry?.outcome, latencyMs: logEntry?.latencyMs,
                        inputTokens: logEntry?.inputTokens, outputTokens: logEntry?.outputTokens,
                        modelVersion: logEntry?.modelVersion, promptVersion: logEntry?.promptVersion,
                        pass: checks.every(c => c.pass), checks, output,
                    };
                });
            }
        }
    }

    const results = await runPool(jobs, CONCURRENCY);
    const summary = summarise(results, { model, repeats });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/results.json`, JSON.stringify({ summary, results }, null, 2));
    const markdown = toMarkdown(summary, results);
    writeFileSync(`${outDir}/report.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);

    const minPassRate = process.env.EVAL_MIN_PASS_RATE;
    if (minPassRate && summary.overall.passRate < Number(minPassRate)) {
        console.error(`Pass rate ${summary.overall.passRate.toFixed(2)} is below ${minPassRate}.`);
        process.exit(1);
    }
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
