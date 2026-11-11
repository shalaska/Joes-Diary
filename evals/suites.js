import { CALENDAR_NOTE_CASES } from './cases/calendarNote.js';
import { CHAT_CASES } from './cases/chat.js';
import { EDIT_CASES } from './cases/edit.js';
import { EXTRACT_TODOS_CASES } from './cases/extractTodos.js';
import { gradeCalendarNote, gradeChat, gradeEdit, gradeExtractTodos } from './graders.js';

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
];
