// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES, handleSignoutClick, readStoredToken, storeAccessToken } from './googleCalendarService';

describe('Google Calendar access', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('asks only for events and a read-only calendar list', () => {
        const scopes = SCOPES.split(' ');
        expect(scopes).toEqual([
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        ]);
        expect(scopes).not.toContain('https://www.googleapis.com/auth/calendar');
    });

    it('keeps the token in sessionStorage, never localStorage', () => {
        storeAccessToken({ access_token: 'abc', expires_in: 3600 });
        expect(localStorage.getItem('google_calendar_token')).toBeNull();
        expect(readStoredToken()).toMatchObject({ access_token: 'abc' });
    });

    it('drops tokens left in localStorage by older versions', () => {
        localStorage.setItem('google_calendar_token', JSON.stringify({ access_token: 'old' }));
        localStorage.setItem('google_calendar_token_expiry', String(Date.now() + 60_000));
        expect(readStoredToken()).toBeNull();
        expect(localStorage.getItem('google_calendar_token')).toBeNull();
    });

    it('treats expired or corrupt tokens as signed out', () => {
        storeAccessToken({ access_token: 'abc', expires_in: -1 });
        expect(readStoredToken()).toBeNull();
        sessionStorage.setItem('google_calendar_token', '{bad');
        sessionStorage.setItem('google_calendar_token_expiry', String(Date.now() + 60_000));
        expect(readStoredToken()).toBeNull();
    });

    it('clears the token on sign-out', () => {
        globalThis.gapi = { client: { getToken: () => null, setToken: () => {} } };
        storeAccessToken({ access_token: 'abc', expires_in: 3600 });
        handleSignoutClick();
        expect(sessionStorage.getItem('google_calendar_token')).toBeNull();
        delete globalThis.gapi;
    });
});
