// @vitest-environment node
// Offline tests: the graders behave as intended, and every case is a valid gateway input.
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../gateway/src/features.js';
import { gradeCalendarNote, gradeChat, gradeEdit, gradeExtractTodos } from './graders.js';
import { summarise, toMarkdown } from './report.js';
import { SUITES } from './suites.js';

const failed = (checks) => checks.filter(c => !c.pass).map(c => c.name);

describe('eval cases', () => {
    it('are all valid gateway inputs with unique ids', () => {
        for (const suite of SUITES) {
            const ids = suite.cases.map(c => c.id);
            expect(new Set(ids).size, `${suite.feature} ids`).toBe(ids.length);
            for (const testCase of suite.cases) {
                expect(FEATURES[suite.feature].validateInput(suite.input(testCase)), `${suite.feature}/${testCase.id}`).toBe(true);
            }
        }
    });
});

describe('gradeExtractTodos', () => {
    const testCase = { expect: [{ any: ['insurance'], priority: 'high' }, { any: ['dentist'] }], mustNotInclude: ['boiler'], maxTodos: 2 };

    it('passes a correct answer', () => {
        expect(failed(gradeExtractTodos(testCase, [{ text: 'Renew car insurance', priority: 'high' }, { text: 'Call the dentist', priority: 'medium' }]))).toEqual([]);
    });

    it('flags a missed todo, a wrong priority, a non-task and over-extraction', () => {
        const checks = gradeExtractTodos(testCase, [
            { text: 'Renew car insurance', priority: 'low' },
            { text: 'Fix the boiler', priority: 'medium' },
            { text: 'Something else', priority: 'low' },
        ]);
        expect(failed(checks)).toEqual(['finds_expected_todos', 'priority:insurance', 'no_over_extraction', 'no_non_tasks']);
    });

    it('expects an empty list when there is nothing to do', () => {
        expect(failed(gradeExtractTodos({ expect: [], maxTodos: 0 }, []))).toEqual([]);
        expect(failed(gradeExtractTodos({ expect: [], maxTodos: 0 }, [{ text: 'Relax', priority: 'low' }]))).toEqual(['no_over_extraction']);
    });
});

describe('gradeCalendarNote', () => {
    const testCase = {
        events: [
            { time: '09:00–09:30', title: 'Team standup', mustMention: ['standup'] },
            { time: '12:30–13:30', title: 'Lunch with Priya', mustMention: ['Priya'] },
        ],
        forbidden: ['conflict'],
    };
    const good = '## Day from My Calendar\nThe day was scheduled around a 09:00 standup and lunch with Priya at 12:30.\n## Shape of the Day\nLight.\n## Insight or Observation\nA long gap after lunch.';

    it('passes a well-formed, grounded note', () => {
        expect(failed(gradeCalendarNote(testCase, good))).toEqual([]);
    });

    it('flags a missing event, an invented time and a forbidden word', () => {
        const bad = '## Day from My Calendar\nThe calendar had a standup at 9:00 and a conflict at 16:45.\n## Shape of the Day\nx\n## Insight or Observation\ny';
        expect(failed(gradeCalendarNote(testCase, bad))).toEqual(['mentions_every_event', 'no_invented_times', 'no_forbidden_phrases']);
    });

    it('flags missing structure', () => {
        expect(failed(gradeCalendarNote(testCase, 'Standup and lunch with Priya were planned.'))).toEqual(['starts_with_heading', 'has_shape_section', 'has_insight_section']);
    });
});

describe('gradeChat', () => {
    it('checks type, topic, length and forbidden phrases', () => {
        const testCase = { expectType: ['question'], mustMentionAny: ['salary'], mustNotInclude: ['HACKED'], maxWords: 10 };
        expect(failed(gradeChat(testCase, { type: 'question', content: 'How much does salary matter to you?' }))).toEqual([]);
        expect(failed(gradeChat(testCase, { type: 'expansion', content: 'Great question! HACKED and here are many many many more words than allowed' })))
            .toEqual(['concise', 'no_forbidden_phrases', 'expected_type', 'on_topic']);
    });
});

describe('gradeEdit', () => {
    it('checks the answer prefix, length ratio, kept words and preamble', () => {
        const shorten = { selection: 'a'.repeat(100), maxLengthRatio: 0.7, mustInclude: ['launch'], mustNotInclude: ['Here is'] };
        expect(failed(gradeEdit(shorten, 'We did not set a launch date.'))).toEqual([]);
        expect(failed(gradeEdit(shorten, `Here is the text: ${'b'.repeat(90)}`))).toEqual(['length_ratio', 'keeps_key_words', 'no_forbidden_phrases']);
        expect(failed(gradeEdit({ selection: 'x', expectAnswerPrefix: true }, '[ANSWER]: 6:12 per km'))).toEqual([]);
        expect(failed(gradeEdit({ selection: 'x', expectAnswerPrefix: true }, '6:12 per km'))).toEqual(['answer_prefix']);
    });
});

describe('report', () => {
    it('summarises pass rates per feature and lists failed checks', () => {
        const results = [
            { feature: 'chat', caseId: 'a', run: 1, pass: true, checks: [{ name: 'x', pass: true }], latencyMs: 100, inputTokens: 10, outputTokens: 5, modelVersion: 'm-001' },
            { feature: 'chat', caseId: 'b', run: 1, pass: false, checks: [{ name: 'on_topic', pass: false, detail: 'off' }], latencyMs: 300, inputTokens: 10, outputTokens: 5 },
        ];
        const summary = summarise(results, { model: 'm', repeats: 1 });
        expect(summary.overall.passRate).toBe(0.5);
        expect(summary.byFeature.chat).toMatchObject({ runs: 2, passRate: 0.5, medianLatencyMs: 200 });
        expect(toMarkdown(summary, results)).toContain('| chat | b | on_topic | off |');
    });
});
