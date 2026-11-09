/* global gapi, google */

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events';

let tokenClient;
let gapiInited = false;
let gisInited = false;

/**
 * Callback after GAPI script is loaded.
 */
export async function gapiLoaded() {
    return new Promise((resolve) => {
        gapi.load('client', async () => {
            resolve();
        });
    });
}

/**
 * Initialize the GAPI client.
 */
export async function initializeGapiClient(apiKey) {
    await gapiLoaded();
    await gapi.client.init({
        apiKey: apiKey,
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
}

/**
 * Initialize the GIS client.
 */
export function gisLoaded(clientId, onTokenCallback) {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                throw (resp);
            }
            if (onTokenCallback) onTokenCallback(resp);
        },
    });
    gisInited = true;
    return tokenClient;
}

/**
 *  Sign in the user upon button click.
 */
export function handleAuthClick() {
    if (!tokenClient) return;
    // prompt: '' will skip the consent screen if the user has already granted access
    // and is signed into Google. It will still open a popup but it should close immediately.
    tokenClient.requestAccessToken({ prompt: '' });
}

/**
 *  Sign out the user upon button click.
 */
export function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('google_calendar_token');
        localStorage.removeItem('google_calendar_token_expiry');
    }
}

/**
 * Try to restore a previous session from localStorage.
 */
export function tryRestoreSession() {
    const tokenString = localStorage.getItem('google_calendar_token');
    const expiryString = localStorage.getItem('google_calendar_token_expiry');

    if (tokenString) {
        // Check expiry if available
        if (expiryString) {
            const expiryTime = parseInt(expiryString, 10);
            if (Date.now() >= expiryTime) {
                console.warn("Stored Google Calendar token has expired.");
                localStorage.removeItem('google_calendar_token');
                localStorage.removeItem('google_calendar_token_expiry');
                return false;
            }
        }

        try {
            const token = JSON.parse(tokenString);
            gapi.client.setToken(token);
            return true;
        } catch (e) {
            console.error("Invalid stored token", e);
            localStorage.removeItem('google_calendar_token');
            localStorage.removeItem('google_calendar_token_expiry');
            return false;
        }
    }
    return false;
}

/**
 * List events for a specific day.
 * @param {Date} date - The date to fetch events for.
 */
export async function listCalendars() {
    if (!gapiInited) throw new Error("GAPI not initialized");

    try {
        const response = await gapi.client.calendar.calendarList.list({
            'showDeleted': false,
            // Include subscribed calendars from Google Calendar's "Other calendars" section.
            'showHidden': true,
        });
        return (response.result.items || []).sort((first, second) => {
            if (first.primary) return -1;
            if (second.primary) return 1;
            return (first.summary || '').localeCompare(second.summary || '');
        });
    } catch (err) {
        console.error("Error listing calendars", err);
        throw err;
    }
}

export async function listEventsForDay(date, calendarIds = ['primary']) {
    if (!gapiInited) throw new Error("GAPI not initialized");

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
        const requestedCalendarIds = calendarIds.length ? calendarIds : ['primary'];
        const eventResults = await Promise.allSettled(requestedCalendarIds.map(async (calendarId) => {
            const response = await gapi.client.calendar.events.list({
                'calendarId': calendarId,
                'timeMin': startOfDay.toISOString(),
                'timeMax': endOfDay.toISOString(),
                'showDeleted': false,
                'singleEvents': true,
                'maxResults': 50,
                'orderBy': 'startTime',
            });
            return (response.result.items || []).map(event => ({
                ...event,
                _calendarId: calendarId,
            }));
        }));

        const eventGroups = eventResults
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);
        const failedCalendarCount = eventResults.length - eventGroups.length;
        if (failedCalendarCount > 0) {
            console.warn(`Could not read events from ${failedCalendarCount} selected calendar(s).`);
        }
        if (eventGroups.length === 0 && eventResults.length > 0) {
            throw eventResults[0].reason;
        }

        return eventGroups.flat().sort((first, second) => {
            const firstStart = new Date(first.start.dateTime || first.start.date).getTime();
            const secondStart = new Date(second.start.dateTime || second.start.date).getTime();
            return firstStart - secondStart;
        });
    } catch (err) {
        console.error("Error listing events", err);
        throw err;
    }
}

/**
 * Add a new event.
 */
export async function addEvent(event) {
    if (!gapiInited) throw new Error("GAPI not initialized");

    try {
        const response = await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event,
        });
        return response.result;
    } catch (err) {
        console.error("Error creating event", err);
        throw err;
    }
}

/**
 * Delete an event from the primary calendar.
 */
export async function deleteEvent(eventId, calendarId = 'primary') {
    if (!gapiInited) throw new Error("GAPI not initialized");
    if (!eventId) throw new Error("Event ID is required");

    try {
        await gapi.client.calendar.events.delete({
            'calendarId': calendarId,
            'eventId': eventId,
        });
    } catch (err) {
        console.error("Error deleting event", err);
        throw err;
    }
}

export function isReady() {
    return gapiInited && gisInited;
}
