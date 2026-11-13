import { callLlmLong } from './llmGateway';
import { filterEventsForAi } from '../utils/aiCalendarPrivacy';

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// The visible calendar day, as { 'YYYY-MM-DD': [{ time, title }] }, only from calendars shared with AI.
export const calendarForAgent = (calendarContext) => {
    if (!calendarContext || !Array.isArray(calendarContext.events)) return {};
    const day = new Date(calendarContext.date);
    if (Number.isNaN(day.getTime())) return {};
    const events = filterEventsForAi(calendarContext.events).slice(0, 100).map((event) => {
        const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
        return {
            time: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : 'All day',
            title: String(event.summary || '(No title)').slice(0, 500),
        };
    });
    return events.length ? { [localDay(day)]: events } : {};
};

// Ask the diary agent. Returns { answer, citedDays, proposals }: proposals are suggestions
// (a to-do, or a note for a day) that change nothing until the user adds them.
export const askDiary = (question, calendarContext) => callLlmLong('ask', {
    question: question.trim().slice(0, 2000),
    today: localDay(new Date()),
    calendar: calendarForAgent(calendarContext),
});

// Splits an answer into text and cited-day parts, so days can be shown as links.
export const splitCitations = (answer) => String(answer || '')
    .split(/(\[\d{4}-\d{2}-\d{2}\])/g)
    .filter(Boolean)
    .map(part => (/^\[\d{4}-\d{2}-\d{2}\]$/.test(part) ? { day: part.slice(1, -1) } : { text: part }));

// 'YYYY-MM-DD' -> the app's day key (Date#toDateString in local time).
export const dayToGroupId = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toDateString();
};
