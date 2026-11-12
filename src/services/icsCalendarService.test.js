import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../db.js', () => ({ db: {} }));

const { dedupeFeedEvents, fetchIcsEventsForDay, FeedNotConfiguredError, feedUrl, ICS_FEEDS, parseIcsEventsForDay } = await import('./icsCalendarService.js');

const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nEND:VCALENDAR\r\n';

afterEach(() => vi.unstubAllGlobals());

describe('fetchIcsEventsForDay', () => {
    it('sends the Firebase ID token to the proxy', async () => {
        const fetchMock = vi.fn(async () => new Response(EMPTY_ICS, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await fetchIcsEventsForDay('https://proxy.example/calendar.ics', new Date('2026-11-09T12:00:00'), async () => 'id-token');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    });

    it('does not call the proxy at all when nobody is signed in', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchIcsEventsForDay('https://proxy.example/calendar.ics', new Date(), async () => undefined)).rejects.toThrow('Sign in');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('personal feed', () => {
    const personal = ICS_FEEDS.find(feed => feed.id === 'personal-ics');
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
        'BEGIN:VEVENT', 'UID:abc@google.com', 'DTSTART:20261109T090000Z', 'DTEND:20261109T100000Z', 'SUMMARY:Dentist', 'END:VEVENT',
        'END:VCALENDAR', '',
    ].join('\r\n');

    it('lives next to the work feed on the same proxy', () => {
        expect(feedUrl('https://proxy.example/calendar.ics', personal)).toBe('https://proxy.example/personal.ics');
        expect(feedUrl('', personal)).toBe('');
    });

    it('labels events with the feed and keeps the UID', async () => {
        const [event] = await parseIcsEventsForDay(ics, new Date('2026-11-09T12:00:00Z'), personal);
        expect(event).toMatchObject({ summary: 'Dentist', _calendarId: 'personal-ics', _calendarName: 'Personal', _uid: 'abc@google.com', _readOnly: true });
    });

    it('reports a feed the proxy has not set up', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('ICS feed is not configured', { status: 503 })));
        await expect(fetchIcsEventsForDay('https://proxy.example/calendar.ics', new Date(), async () => 't', personal)).rejects.toBeInstanceOf(FeedNotConfiguredError);
    });

    it('drops feed events that Google already shows', () => {
        const google = [{ iCalUID: 'abc@google.com', start: { dateTime: '2026-11-09T09:00:00Z' } }];
        const feed = [
            { _uid: 'abc@google.com', start: { dateTime: '2026-11-09T09:00:00.000Z' } },
            { _uid: 'abc@google.com', start: { dateTime: '2026-11-10T09:00:00Z' } },
            { _uid: 'other', start: { dateTime: '2026-11-09T09:00:00Z' } },
        ];
        expect(dedupeFeedEvents(google, feed)).toEqual(feed.slice(1));
    });
});
