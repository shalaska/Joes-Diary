// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCalendarContext } from './geminiService';
import { ICS_CALENDAR_ID } from './icsCalendarService';

const event = (summary, calendarId, hour) => ({
    summary,
    _calendarId: calendarId,
    start: { dateTime: new Date(2026, 10, 9, hour).toISOString() },
    end: { dateTime: new Date(2026, 10, 9, hour + 1).toISOString() },
});

describe('formatCalendarContext', () => {
    beforeEach(() => localStorage.clear());

    it('never puts work-calendar events into the prompt by default', () => {
        const prompt = formatCalendarContext({
            date: new Date(2026, 10, 9).toISOString(),
            events: [event('Dentist', 'primary', 9), event('Quarterly planning', ICS_CALENDAR_ID, 11)],
        });
        expect(prompt).toContain('Dentist');
        expect(prompt).not.toContain('Quarterly planning');
    });

    it('says there are no events when every event is blocked', () => {
        const prompt = formatCalendarContext({
            date: new Date(2026, 10, 9).toISOString(),
            events: [event('Quarterly planning', ICS_CALENDAR_ID, 11)],
        });
        expect(prompt).toContain('- No events scheduled.');
    });

    it('returns nothing without a calendar context', () => {
        expect(formatCalendarContext(null)).toBe('');
        expect(formatCalendarContext({ date: 'x' })).toBe('');
    });
});
