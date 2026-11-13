import { CALENDAR_NOTE_CASES } from './cases/calendarNote.js';
import { CHAT_CASES } from './cases/chat.js';
import { EDIT_CASES } from './cases/edit.js';
import { EXTRACT_TODOS_CASES } from './cases/extractTodos.js';
import { ASK_CASES, TODAY } from './cases/ask.js';
import { WEEK_REVIEW_CASES } from './cases/weekReview.js';
import { DIARY, DIARY_DAYS, TODOS, diaryStore } from './agent/diary.js';
import { gradeAsk, gradeCalendarNote, gradeChat, gradeEdit, gradeExtractTodos, gradeWeekReview } from './graders.js';
import { createAskHandler } from '../gateway/src/agent.js';

// One suite per gateway feature: the cases, how to turn a case into gateway input, and its grader.
export const SUITES = [
    { feature: 'extractTodos', cases: EXTRACT_TODOS_CASES, input: (c) => ({ text: c.text }), grade: gradeExtractTodos },
    {
        feature: 'calendarNote',
        cases: CALENDAR_NOTE_CASES,
        input: (c) => ({ dateLabel: c.dateLabel, events: c.events.map(({ time, title, location, description }) => ({ time, title, location, description })) }),
        grade: gradeCalendarNote,
    },
    { feature: 'chat', cases: CHAT_CASES, input: (c) => ({ text: c.text }), grade: gradeChat },
    { feature: 'edit', cases: EDIT_CASES, input: (c) => ({ selection: c.selection, instruction: c.instruction }), grade: gradeEdit },
    { feature: 'weekReview', cases: WEEK_REVIEW_CASES, input: (c) => ({ weekLabel: c.weekLabel, days: c.days }), grade: gradeWeekReview },
    {
        // The agent: runs through createAskHandler over the synthetic diary, not the single-shot handler.
        // Suggestions are kept in memory: the eval store saves nothing.
        feature: 'ask',
        cases: ASK_CASES,
        input: (c) => ({ question: c.question, today: TODAY }),
        makeHandler: ({ callTools, model, log }) => {
            const store = { ...diaryStore, saveProposals: async (proposals) => proposals.map((_, i) => `eval-${i}`) };
            const ask = createAskHandler({ callTools, model, store, log, allowedTiers: ['read', 'propose'] });
            return ({ input }) => ask(input);
        },
        grade: (c, output, logEntry) => gradeAsk(c, output, logEntry, DIARY_DAYS),
        // The judge sees the entries that matter (the expected days and the days the answer
        // cited) and the to-do list, not the whole diary: enough to check grounding, at a
        // fraction of the tokens. Code graders check invented days and not-found honesty.
        judgeInput: (c, output) => {
            const days = new Set([...c.expectDays, ...(c.mayCite ?? []), ...(output?.citedDays ?? [])]);
            const entries = DIARY.filter(e => days.has(e.date.slice(0, 10)));
            return {
                question: c.question, today: TODAY,
                diary: entries.length ? entries.map(e => `${e.date.slice(0, 10)}: ${e.content}`).join('\n') : '(no entry in the diary is relevant to this question)',
                note: 'Only the relevant entries of a longer diary are shown.',
                todos: TODOS.map(t => `${t.completed ? '[done]' : '[open]'} ${t.text} (${t.priority})`).join('\n'),
            };
        },
    },
];
