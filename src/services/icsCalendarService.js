import ICAL from 'ical.js';

export const ICS_CALENDAR_ID = 'outlook-ics';
export const ICS_CALENDAR_NAME = 'Work';
export const ICS_CALENDAR_COLOR = '#7CB342';

const overlapsDay = (start, end, dayStart, dayEnd) => start < dayEnd && end > dayStart;

const toCalendarEvent = (event, startTime, endTime) => {
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
        _calendarId: ICS_CALENDAR_ID,
        _calendarName: ICS_CALENDAR_NAME,
        _calendarColor: ICS_CALENDAR_COLOR,
        _readOnly: true,
    };
};

const expandEventForDay = (event, dayStart, dayEnd) => {
    const componentStatus = event.component.getFirstPropertyValue('status');
    if (componentStatus === 'CANCELLED' || event.isRecurrenceException()) return [];

    if (!event.isRecurring()) {
        const start = event.startDate.toJSDate();
        const end = event.endDate.toJSDate();
        return overlapsDay(start, end, dayStart, dayEnd)
            ? [toCalendarEvent(event, event.startDate, event.endDate)]
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
            occurrences.push(toCalendarEvent(details.item, details.startDate, details.endDate));
        }
    }
    return occurrences;
};

export const parseIcsEventsForDay = (icsText, date) => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const calendarComponent = new ICAL.Component(ICAL.parse(icsText));
    return calendarComponent
        .getAllSubcomponents('vevent')
        .map(component => new ICAL.Event(component))
        .flatMap(event => expandEventForDay(event, dayStart, dayEnd))
        .sort((first, second) => {
            const firstStart = new Date(first.start.dateTime || first.start.date).getTime();
            const secondStart = new Date(second.start.dateTime || second.start.date).getTime();
            return firstStart - secondStart;
        });
};

export const fetchIcsEventsForDay = async (proxyUrl, date) => {
    if (!proxyUrl) return [];
    const response = await fetch(proxyUrl, { headers: { Accept: 'text/calendar' } });
    if (!response.ok) throw new Error(`ICS proxy returned ${response.status}`);
    return parseIcsEventsForDay(await response.text(), date);
};
