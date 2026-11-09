import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../db.js', () => ({ db: {} }));

const { fetchIcsEventsForDay } = await import('./icsCalendarService.js');

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
