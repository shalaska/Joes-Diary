import { describe, expect, it } from 'vitest';
import { pickSuites, toOutputs } from './pickSuites.js';

describe('pickSuites', () => {
    it('runs only the ask suite for an agent change', () => {
        expect(pickSuites(['gateway/src/agent.js', 'gateway/src/agent.test.js', 'evals/cases/ask.js', 'src/App.jsx', 'README.md']))
            .toEqual({ skip: false, smoke: false, calibrate: false, features: ['ask'] });
    });

    it('runs the single-shot suites for a prompt change, and every suite for the client or the model config', () => {
        expect(pickSuites(['gateway/src/features.js']).features).toEqual(['extractTodos', 'calendarNote', 'chat', 'edit', 'weekReview']);
        expect(pickSuites(['gateway/.env.joesdiary-d8211']).features).toEqual(['extractTodos', 'calendarNote', 'chat', 'edit', 'weekReview', 'ask']);
        expect(pickSuites(['gateway/src/gemini.js']).features).toHaveLength(6);
    });

    it('runs one suite for a change to that suite\'s cases', () => {
        expect(pickSuites(['evals/cases/chat.js', 'evals/graders.js'])).toEqual({ skip: false, smoke: false, calibrate: false, features: ['chat'] });
    });

    it('checks the harness cheaply when only the harness changes', () => {
        const pick = pickSuites(['evals/run.js', 'evals/pricing.js', '.github/workflows/evals.yml']);
        expect(pick).toEqual({ skip: false, smoke: true, calibrate: false, features: ['edit'] });
        expect(toOutputs(pick)).toBe('skip=false\ncalibrate=false\nfeatures=edit\nrepeats=1\ngate=false');
    });

    it('calibrates the judge only when the judge or its labels change', () => {
        expect(pickSuites(['evals/judge.js'])).toEqual({ skip: false, smoke: true, calibrate: true, features: ['edit'] });
        expect(pickSuites(['evals/calibration.js', 'gateway/src/agent.js'])).toEqual({ skip: false, smoke: false, calibrate: true, features: ['ask'] });
    });

    it('makes no model calls for tests and docs', () => {
        const pick = pickSuites(['evals/pricing.test.js', 'evals/README.md', 'evals/results/hydrogen-2026-11.md', 'gateway/src/handler.test.js', '']);
        expect(pick).toEqual({ skip: true, smoke: false, calibrate: false, features: [] });
        expect(toOutputs(pick)).toBe('skip=true\ncalibrate=false\nfeatures=\nrepeats=\ngate=true');
    });
});
