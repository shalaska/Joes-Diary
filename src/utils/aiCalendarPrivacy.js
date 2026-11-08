import { ICS_CALENDAR_ID } from '../services/icsCalendarService';

// Calendars whose events must never be sent to an AI model.
// The Outlook work feed is excluded by default, so a new device is safe before any setting is saved.
const AI_EXCLUDED_CALENDARS_KEY = 'ai_excluded_calendar_ids';
const DEFAULT_AI_EXCLUDED_CALENDAR_IDS = [ICS_CALENDAR_ID];

export const getAiExcludedCalendarIds = () => {
    try {
        const saved = localStorage.getItem(AI_EXCLUDED_CALENDARS_KEY);
        if (saved === null) return [...DEFAULT_AI_EXCLUDED_CALENDAR_IDS];
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [...DEFAULT_AI_EXCLUDED_CALENDAR_IDS];
    } catch {
        return [...DEFAULT_AI_EXCLUDED_CALENDAR_IDS];
    }
};

export const saveAiExcludedCalendarIds = (calendarIds) => {
    localStorage.setItem(AI_EXCLUDED_CALENDARS_KEY, JSON.stringify([...new Set(calendarIds)]));
};

export const isCalendarAllowedForAi = (calendarId, excludedIds = getAiExcludedCalendarIds()) => (
    !excludedIds.includes(calendarId || 'primary')
);

// Drops events from calendars that are not allowed to reach an AI model.
export const filterEventsForAi = (events, excludedIds = getAiExcludedCalendarIds()) => (
    (events || []).filter(event => isCalendarAllowedForAi(event?._calendarId, excludedIds))
);
