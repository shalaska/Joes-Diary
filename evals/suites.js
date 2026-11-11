import { CALENDAR_NOTE_CASES } from './cases/calendarNote.js';
import { CHAT_CASES } from './cases/chat.js';
import { EDIT_CASES } from './cases/edit.js';
import { EXTRACT_TODOS_CASES } from './cases/extractTodos.js';
import { ASK_CASES, TODAY } from './cases/ask.js';
import { DIARY, DIARY_DAYS, diaryStore } from './agent/diary.js';
import { gradeAsk, gradeCalendarNote, gradeChat, gradeEdit, gradeExtractTodos } from './graders.js';
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
    {
        // The agent: runs through createAskHandler over the synthetic diary, not the single-shot handler.
        feature: 'ask',
        cases: ASK_CASES,
        input: (c) => ({ question: c.question, today: TODAY }),
        makeHandler: ({ callTools, model, log }) => {
            const ask = createAskHandler({ callTools, model, store: diaryStore, log });
            return ({ input }) => ask(input);
        },
        grade: (c, output, logEntry) => gradeAsk(c, output, logEntry, DIARY_DAYS),
        // The judge sees the whole synthetic diary so it can check groundedness.
        judgeInput: (c) => ({ question: c.question, today: TODAY, diary: DIARY.map(e => `${e.date.slice(0, 10)}: ${e.content}`).join('\n') }),
    },
];
