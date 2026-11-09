// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    filterEventsForAi,
    getAiExcludedCalendarIds,
    isCalendarAllowedForAi,
    saveAiExcludedCalendarIds,
} from './aiCalendarPrivacy';
import { ICS_CALENDAR_ID } from '../services/icsCalendarService';

describe('aiCalendarPrivacy', () => {
    beforeEach(() => localStorage.clear());

    it('blocks the Outlook work calendar on a fresh device', () => {
        expect(getAiExcludedCalendarIds()).toEqual([ICS_CALENDAR_ID]);
        expect(isCalendarAllowedForAi(ICS_CALENDAR_ID)).toBe(false);
        expect(isCalendarAllowedForAi('primary')).toBe(true);
    });

    it('falls back to the safe default when the saved value is corrupt', () => {
        localStorage.setItem('ai_excluded_calendar_ids', '{not json');
        expect(getAiExcludedCalendarIds()).toEqual([ICS_CALENDAR_ID]);
        localStorage.setItem('ai_excluded_calendar_ids', '"a string"');
        expect(getAiExcludedCalendarIds()).toEqual([ICS_CALENDAR_ID]);
    });

    it('respects a saved choice, including allowing every calendar', () => {
        saveAiExcludedCalendarIds(['family', 'family']);
        expect(getAiExcludedCalendarIds()).toEqual(['family']);
        saveAiExcludedCalendarIds([]);
        expect(isCalendarAllowedForAi(ICS_CALENDAR_ID)).toBe(true);
    });

    it('treats events without a calendar id as the primary calendar', () => {
        expect(isCalendarAllowedForAi(undefined, ['primary'])).toBe(false);
    });

    it('drops only events from blocked calendars', () => {
        const events = [
            { summary: 'Gym', _calendarId: 'primary' },
            { summary: 'Standup', _calendarId: ICS_CALENDAR_ID },
            { summary: 'No id' },
        ];
        expect(filterEventsForAi(events).map(e => e.summary)).toEqual(['Gym', 'No id']);
        expect(filterEventsForAi(null)).toEqual([]);
    });
});
