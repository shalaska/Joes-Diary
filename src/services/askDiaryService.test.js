import { describe, expect, it } from 'vitest';
import { calendarForAgent, dayToGroupId, splitCitations } from './askDiaryService';

describe('askDiaryService', () => {
    it('splits cited days out of an answer', () => {
        expect(splitCitations('You ran [2026-03-02] and [2026-03-09].')).toEqual([
            { text: 'You ran ' }, { day: '2026-03-02' }, { text: ' and ' }, { day: '2026-03-09' }, { text: '.' },
        ]);
    });

    it('maps a cited day to the app day key', () => {
        expect(dayToGroupId('2026-03-02')).toBe(new Date(2026, 2, 2).toDateString());
    });

    it('sends only the visible day, with time and title', () => {
        const context = { date: new Date(2026, 2, 2, 12).toISOString(), events: [{ summary: 'Dentist', start: { dateTime: new Date(2026, 2, 2, 9, 0).toISOString() } }, { summary: 'Holiday', start: { date: '2026-03-02' } }] };
        expect(calendarForAgent(context)).toEqual({ '2026-03-02': [{ time: '09:00', title: 'Dentist' }, { time: 'All day', title: 'Holiday' }] });
        expect(calendarForAgent(null)).toEqual({});
    });
});
