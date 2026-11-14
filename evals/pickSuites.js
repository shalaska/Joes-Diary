// Decides what a pull request's eval run needs, from the files it changes. Every run costs
// money, so a PR only runs the suites its change can affect:
// - the Gemini client or the model config: every suite
// - prompts and the single-shot handler: the single-shot suites
// - the agent: the ask suite
// - one feature's cases: that feature's suite
// - only the eval harness (runner, graders, gate, report, pricing, the workflow): one cheap
//   suite, once and ungated, to prove the harness still runs end to end
// - the judge or its hand labels: the same, plus the judge calibration
// - tests and docs only: no model calls at all
//
//   git diff --name-only origin/main...HEAD | node evals/pickSuites.js   # prints key=value lines
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SINGLE_SHOT = ['extractTodos', 'calendarNote', 'chat', 'edit', 'weekReview'];
export const SMOKE_SUITE = 'edit';
const ALL = [...SINGLE_SHOT, 'ask'];

const IGNORED = /(\.test\.js|\.md)$|^evals\/results\//;
const EVERYTHING = /^gateway\/(src\/gemini\.js|\.env)/;
const SINGLE = /^gateway\/src\/(features|handler)\.js$/;
const AGENT = /^(gateway\/src\/agent\.js|gateway\/index\.js|evals\/agent\/)/;
const CASES = /^evals\/cases\/(\w+)\.js$/;
const JUDGE = /^evals\/(judge|calibration)\.js$/;
const HARNESS = /^(evals\/|gateway\/|\.github\/workflows\/evals\.yml$)/;

export const pickSuites = (files) => {
    const features = new Set();
    let harness = false;
    let calibrate = false;
    for (const file of files.map(f => f.trim()).filter(f => f && !IGNORED.test(f))) {
        const cases = CASES.exec(file);
        if (EVERYTHING.test(file)) ALL.forEach(f => features.add(f));
        else if (SINGLE.test(file)) SINGLE_SHOT.forEach(f => features.add(f));
        else if (AGENT.test(file)) features.add('ask');
        else if (cases && ALL.includes(cases[1])) features.add(cases[1]);
        else if (JUDGE.test(file)) { calibrate = true; harness = true; }
        else if (HARNESS.test(file)) harness = true;
    }
    if (features.size) return { skip: false, smoke: false, calibrate, features: ALL.filter(f => features.has(f)) };
    if (harness) return { skip: false, smoke: true, calibrate, features: [SMOKE_SUITE] };
    return { skip: true, smoke: false, calibrate: false, features: [] };
};

// GitHub Actions step outputs. A smoke run is one repeat and is not gated: it checks the
// harness, not the quality of the answers.
export const toOutputs = (pick) => [
    `skip=${pick.skip}`,
    `calibrate=${pick.calibrate}`,
    `features=${pick.features.join(',')}`,
    `repeats=${pick.smoke ? '1' : ''}`,
    `gate=${!pick.smoke}`,
].join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const pick = pickSuites(readFileSync(0, 'utf8').split('\n'));
    console.error(pick.skip ? 'No eval run: this change cannot affect the answers.' : `Suites: ${pick.features.join(', ')}${pick.smoke ? ' (harness check, one run per case, not gated)' : ''}${pick.calibrate ? ', plus the judge calibration' : ''}`);
    console.log(toOutputs(pick));
}
