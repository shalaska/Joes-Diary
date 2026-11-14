// Runs every eval suite against a Gemini model through the production gateway handler
// (same prompts, schemas and output checks as live), grades each answer with the code
// graders, and writes a JSON result file and a Markdown report.
//
//   GEMINI_API_KEY=... node evals/run.js                 # the pinned model
//   GEMINI_API_KEY=... EVAL_MODEL=gemini-x.y-flash node evals/run.js
//
// Options (env): EVAL_MODEL, EVAL_THINKING (low|medium|high), EVAL_FEATURES (comma list), EVAL_REPEATS (default 1),
// EVAL_AGENT_REPEATS (runs per agent case, default EVAL_REPEATS: the agent costs the most),
// EVAL_OUT (default eval-results), EVAL_MIN_PASS_RATE (fail the run below this, 0-1),
// EVAL_JUDGE_MODEL (default: newest stable Pro), EVAL_JUDGE=0 (code graders only),
// EVAL_CALIBRATE=1 (only score the judge against the hand labels in calibration.js),
// EVAL_GATE=1 (fail the run if it regresses against evals/baseline.json),
// EVAL_WRITE_BASELINE=1 (write evals/baseline.json from this run),
// EVAL_MAX_COST_EUR (stop starting cases once the run has cost this much, and fail the run).
// Every run ends with what it cost, judge included (evals/pricing.js).
// Inputs are synthetic. Nothing here reads or sends diary data.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHandler } from '../gateway/src/handler.js';
import { createGeminiClient, createGeminiToolClient } from '../gateway/src/gemini.js';
import { CALIBRATION } from './calibration.js';
import { createJudge, judgeCandidates } from './judge.js';
import { readFeatureModels, readPinnedModel, readThinking } from '../scripts/geminiModel.js';
import { SUITES } from './suites.js';
import { calibrationMarkdown, summarise, toMarkdown } from './report.js';
import { compareToBaseline, gateMarkdown, toBaseline } from './gate.js';
import { FEATURES } from '../gateway/src/features.js';
import { listModels } from './models.js';
import { costMarkdown, createMeter } from './pricing.js';
import { createEvalTracing, traceCase, traceJudge, traceModel } from './tracing.js';

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

// Newest stable Pro that actually answers, else the model under test.
const chooseJudgeModel = async (apiKey, callModel, fallback) => {
    const candidates = judgeCandidates(await listModels(apiKey));
    console.log(`Judge candidates: ${candidates.join(', ') || 'none'}`);
    for (const name of candidates) {
        try {
            await callModel({ model: name, prompt: 'Reply with OK.' });
            return name;
        } catch (error) {
            console.log(`Judge candidate ${name} is not callable: ${error.message}`);
        }
    }
    return fallback;
};

const calibrate = async (judge, judgeModel, outDir, meter) => {
    const rows = await runPool(CALIBRATION.map(item => async () => {
        const verdict = await judge(item.feature, item.input, item.output).catch(error => ({ pass: null, scores: {}, reason: `judge error: ${error.message}` }));
        return { ...item, judged: verdict.pass === null ? 'error' : (verdict.pass ? 'pass' : 'fail'), scores: verdict.scores, reason: verdict.reason };
    }), CONCURRENCY);
    const markdown = `${calibrationMarkdown(judgeModel, rows)}\n${costMarkdown(meter)}`;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/calibration.json`, JSON.stringify(rows, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);
};

const main = async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    const envText = readFileSync('gateway/.env.joesdiary-d8211', 'utf8');
    const model = process.env.EVAL_MODEL || readPinnedModel(envText);
    // Without EVAL_MODEL the evals test the live setup, per-feature overrides included.
    // With it (e.g. a bake-off or the model bump) every feature uses that one model.
    const featureModels = process.env.EVAL_MODEL ? {} : readFeatureModels(envText);
    if (Object.keys(featureModels).length) console.log(`Per-feature models: ${JSON.stringify(featureModels)}`);
    const repeats = Number(process.env.EVAL_REPEATS || 1);
    const agentRepeats = Number(process.env.EVAL_AGENT_REPEATS || repeats);
    const only = (process.env.EVAL_FEATURES || '').split(',').map(s => s.trim()).filter(Boolean);
    const outDir = process.env.EVAL_OUT || 'eval-results';

    // The thinking level applies to the model under test only, as live (GEMINI_THINKING goes with the
    // pinned model, not with per-feature overrides). EVAL_THINKING overrides it; the judge keeps its default.
    const level = process.env.EVAL_THINKING || (process.env.EVAL_MODEL ? '' : readThinking(envText));
    if (level) console.log(`Thinking level for ${model}: ${level}`);
    const thinkingLevel = (m) => (m === model ? level : '');
    // Every model call goes through the meter, so the run can say what it cost and stop at a limit.
    const meter = createMeter();
    // With the Arize secrets set, each case also goes to Arize as a trace (evals/tracing.js).
    const tracing = createEvalTracing();
    const traced = (client, purpose) => (tracing.enabled ? traceModel(client, tracing.tracer, purpose) : client);
    const limitEur = process.env.EVAL_MAX_COST_EUR ? Number(process.env.EVAL_MAX_COST_EUR) : null;
    const plain = createGeminiClient({ apiKey, timeoutMs: 60000 });
    const callJudge = meter.wrap(traced(plain, 'judge'), process.env.EVAL_CALIBRATE === '1' ? 'judge calibration' : 'judge');
    const callFeature = meter.wrap(traced(level ? createGeminiClient({ apiKey, timeoutMs: 60000, thinkingLevel }) : plain, 'under test'), 'under test');
    const callTools = meter.wrap(traced(createGeminiToolClient({ apiKey, timeoutMs: 60000, thinkingLevel }), 'under test'), 'under test');
    const useJudge = process.env.EVAL_JUDGE !== '0';
    const judgeModel = process.env.EVAL_JUDGE_MODEL || (useJudge || process.env.EVAL_CALIBRATE === '1' ? await chooseJudgeModel(apiKey, callJudge, model) : null);
    const judge = useJudge ? createJudge({ callModel: callJudge, model: judgeModel }) : null;

    if (process.env.EVAL_CALIBRATE === '1') {
        await calibrate(createJudge({ callModel: callJudge, model: judgeModel }), judgeModel, outDir, meter);
        if (tracing.enabled) console.log(await tracing.shutdown());
        return;
    }

    const suites = SUITES.filter(suite => only.length === 0 || only.includes(suite.feature));
    const jobs = [];
    let stopped = 0;
    for (const suite of suites) {
        for (const testCase of suite.cases) {
            for (let run = 1; run <= (suite.makeHandler ? agentRepeats : repeats); run++) {
                jobs.push(() => traceCase(tracing, { feature: suite.feature, caseId: testCase.id, run, input: suite.input(testCase), model: featureModels[suite.feature] || model }, async () => {
                    if (limitEur !== null && meter.totalEur() >= limitEur) {
                        stopped += 1;
                        return {
                            feature: suite.feature, caseId: testCase.id, run, outcome: 'not_run', pass: false, output: null, judge: null,
                            checks: [{ name: 'within_spend_limit', pass: false, detail: `not started: the run had reached its spend limit of €${limitEur}` }],
                        };
                    }
                    let logEntry = null;
                    const log = (entry) => { logEntry = entry; };
                    const handle = suite.makeHandler
                        ? suite.makeHandler({ callTools, model: featureModels[suite.feature] || model, log })
                        : createHandler({ callModel: callFeature, model, featureModels, log });
                    let output = null;
                    let errorMessage = '';
                    try {
                        output = (await handle({ feature: suite.feature, input: suite.input(testCase) })).output;
                    } catch (error) {
                        // The outcome is in the log entry; the message (e.g. the HTTP status) goes in the report.
                        errorMessage = error.message;
                    }
                    // ok_at_limit still has an answer: grade it, and let the suite flag the limit.
                    const answered = logEntry?.outcome === 'ok' || logEntry?.outcome === 'ok_at_limit';
                    const checks = answered
                        ? suite.grade(testCase, output, logEntry)
                        : [{ name: 'gateway_ok', pass: false, detail: [logEntry?.outcome ?? 'no log', errorMessage].filter(Boolean).join(': ') }];
                    let judged = null;
                    if (judge && answered) {
                        judged = await traceJudge(tracing, () => judge(suite.feature, (suite.judgeInput || suite.input)(testCase, output), output))
                            .catch(error => ({ error: error.message }));
                        // A judge failure is reported, but never counted against the model under test.
                        if (judged && !judged.error) checks.push({ name: 'judge', pass: judged.pass, detail: `${Object.entries(judged.scores).map(([k, v]) => `${k} ${v}`).join(', ')}. ${judged.reason}` });
                    }
                    return {
                        feature: suite.feature, caseId: testCase.id, run,
                        outcome: logEntry?.outcome, latencyMs: logEntry?.latencyMs,
                        inputTokens: logEntry?.inputTokens, outputTokens: logEntry?.outputTokens,
                        toolCalls: logEntry?.toolCalls,
                        modelVersion: logEntry?.modelVersion, promptVersion: logEntry?.promptVersion,
                        pass: checks.every(c => c.pass), checks, output, judge: judged,
                    };
                }));
            }
        }
    }

    const results = await runPool(jobs, CONCURRENCY);
    // Flush the traces before anything below can exit the process.
    if (tracing.enabled) console.log(await tracing.shutdown());
    const modelLabel = Object.keys(featureModels).length
        ? `${model} (${Object.entries(featureModels).map(([f, m]) => `${f}: ${m}`).join(', ')})`
        : model;
    const summary = summarise(results, { model: modelLabel, repeats, judgeModel: judge ? judgeModel : null });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/results.json`, JSON.stringify({ summary, results }, null, 2));
    let markdown = toMarkdown(summary, results);
    let gateFailed = false;
    if (process.env.EVAL_GATE === '1') {
        const baseline = JSON.parse(readFileSync('evals/baseline.json', 'utf8'));
        // Features left out with EVAL_FEATURES are not gated.
        if (only.length) baseline.features = Object.fromEntries(Object.entries(baseline.features).filter(([f]) => only.includes(f)));
        const regressions = compareToBaseline(summary, baseline);
        gateFailed = regressions.length > 0;
        markdown = `${gateMarkdown(regressions, baseline)}\n${markdown}`;
        writeFileSync(`${outDir}/gate.json`, JSON.stringify({ passed: !gateFailed, regressions }, null, 2));
    }
    if (process.env.EVAL_WRITE_BASELINE === '1') {
        const promptVersions = Object.fromEntries(Object.entries(FEATURES).map(([name, spec]) => [name, spec.promptVersion]));
        const baselineJson = `${JSON.stringify(toBaseline(summary, { promptVersions }), null, 2)}\n`;
        writeFileSync('evals/baseline.json', baselineJson);
        console.log(`New baseline:\n${baselineJson}`);
    }
    markdown = `${markdown}\n${costMarkdown(meter, { limitEur, stopped })}`;
    writeFileSync(`${outDir}/cost.json`, JSON.stringify({ totalEur: meter.totalEur(), limitEur, stopped, rows: meter.rows() }, null, 2));
    writeFileSync(`${outDir}/report.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);

    if (stopped) {
        console.error(`Stopped at the spend limit of €${limitEur}: ${stopped} case run(s) were not started.`);
        process.exit(1);
    }
    if (gateFailed) {
        console.error('Eval gate failed: quality dropped beyond the noise tolerance. See the report.');
        process.exit(1);
    }
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
