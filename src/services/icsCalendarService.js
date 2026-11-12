import { db } from '../db.js';
import { auth } from '../firebase';

export const ICS_CALENDAR_ID = 'outlook-ics';
export const ICS_CALENDAR_NAME = 'Work';
export const ICS_CALENDAR_COLOR = '#7CB342';

// Private iCal feeds served by the calendar proxy. They need no Google sign-in and never expire.
// The settings hold one proxy address (…/calendar.ics); each feed is a sibling path on it.
export const ICS_FEEDS = [
    { id: ICS_CALENDAR_ID, name: ICS_CALENDAR_NAME, color: ICS_CALENDAR_COLOR, path: 'calendar.ics', source: 'Outlook' },
    { id: 'personal-ics', name: 'Personal', color: '#4285F4', path: 'personal.ics', source: 'Google' },
];
export const isIcsCalendarId = (calendarId) => ICS_FEEDS.some(feed => feed.id === calendarId);
export const feedUrl = (proxyUrl, feed) => (proxyUrl ? proxyUrl.replace(/[^/]*$/, feed.path) : '');

// The feed is not set up on the proxy (no secret): the app hides it instead of showing an error.
export class FeedNotConfiguredError extends Error {}

const overlapsDay = (start, end, dayStart, dayEnd) => start < dayEnd && end > dayStart;

const calendarDayKey = (date) => {
    const value = new Date(date);
    return [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0'),
    ].join('-');
};

const cacheKeyForDate = (date, feed) => `${feed.id}:${calendarDayKey(date)}`;

const toCalendarEvent = (event, startTime, endTime, feed) => {
    const isAllDay = startTime.isDate;
    const start = isAllDay
        ? { date: startTime.toString().slice(0, 10) }
        : { dateTime: startTime.toJSDate().toISOString() };
    const end = isAllDay
        ? { date: endTime.toString().slice(0, 10) }
        : { dateTime: endTime.toJSDate().toISOString() };

    return {
        id: `ics:${event.uid || 'event'}:${startTime.toString()}`,
        summary: event.summary || '(No Title)',
        description: event.description || '',
        location: event.location || '',
        start,
        end,
        _uid: event.uid || '',
        _calendarId: feed.id,
        _calendarName: feed.name,
        _calendarColor: feed.color,
        _readOnly: true,
    };
};

const expandEventForDay = (event, dayStart, dayEnd, feed) => {
    const componentStatus = event.component.getFirstPropertyValue('status');
    if (componentStatus === 'CANCELLED' || event.isRecurrenceException()) return [];

    if (!event.isRecurring()) {
        const start = event.startDate.toJSDate();
        const end = event.endDate.toJSDate();
        return overlapsDay(start, end, dayStart, dayEnd)
            ? [toCalendarEvent(event, event.startDate, event.endDate, feed)]
            : [];
    }

    const occurrences = [];
    const iterator = event.iterator();
    let occurrence;
    let attempts = 0;
    while ((occurrence = iterator.next()) && attempts < 10000) {
        attempts += 1;
        const details = event.getOccurrenceDetails(occurrence);
        const occurrenceStart = details.startDate.toJSDate();
        const occurrenceEnd = details.endDate.toJSDate();
        if (occurrenceStart >= dayEnd) break;
        if (overlapsDay(occurrenceStart, occurrenceEnd, dayStart, dayEnd)) {
            occurrences.push(toCalendarEvent(details.item, details.startDate, details.endDate, feed));
        }
    }
    return occurrences;
};

export const parseIcsEventsForDay = async (icsText, date, feed = ICS_FEEDS[0]) => {
    const { default: ICAL } = await import('ical.js');
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const calendarComponent = new ICAL.Component(ICAL.parse(icsText));
    return calendarComponent
        .getAllSubcomponents('vevent')
        .map(component => new ICAL.Event(component))
        .flatMap(event => expandEventForDay(event, dayStart, dayEnd, feed))
        .sort((first, second) => {
            const firstStart = new Date(first.start.dateTime || first.start.date).getTime();
            const secondStart = new Date(second.start.dateTime || second.start.date).getTime();
            return firstStart - secondStart;
        });
};

// The proxy only serves the feed to a signed-in, allowlisted account, so every request
// carries the user's Firebase ID token.
export const fetchIcsEventsForDay = async (proxyUrl, date, getIdToken = () => auth.currentUser?.getIdToken(), feed = ICS_FEEDS[0]) => {
    if (!proxyUrl) return [];
    const idToken = await getIdToken();
    if (!idToken) throw new Error(`Sign in to load the ${feed.name.toLowerCase()} calendar`);
    const response = await fetch(feedUrl(proxyUrl, feed), { headers: { Accept: 'text/calendar', Authorization: `Bearer ${idToken}` } });
    if (response.status === 503) throw new FeedNotConfiguredError(`${feed.name} feed is not set up`);
    if (!response.ok) throw new Error(`ICS proxy returned ${response.status}`);
    return parseIcsEventsForDay(await response.text(), date, feed);
};

export const getCachedIcsEventsForDay = async (proxyUrl, date, feed = ICS_FEEDS[0]) => {
    if (!proxyUrl) return null;
    const cached = await db.calendarCache.get(cacheKeyForDate(date, feed));
    if (!cached || cached.proxyUrl !== proxyUrl || !Array.isArray(cached.events)) return null;
    return cached;
};

export const cacheIcsEventsForDay = async (proxyUrl, date, events, feed = ICS_FEEDS[0]) => {
    if (!proxyUrl) return;
    await db.calendarCache.put({
        key: cacheKeyForDate(date, feed),
        proxyUrl,
        events,
        updatedAt: new Date().toISOString(),
    });
};

// A calendar shown both through Google (signed in) and through its iCal feed would appear twice.
// Keep the Google copy, which can be edited, and drop feed events with the same UID and start.
export const dedupeFeedEvents = (googleEvents, feedEvents) => {
    const startOf = (event) => new Date(event.start.dateTime || event.start.date).getTime();
    const seen = new Set(googleEvents.filter(e => e.iCalUID).map(e => `${e.iCalUID}|${startOf(e)}`));
    return feedEvents.filter(e => !e._uid || !seen.has(`${e._uid}|${startOf(e)}`));
};
