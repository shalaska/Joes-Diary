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
    return new Promise((resolve, reject) => {
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
    tokenClient.requestAccessToken({ prompt: 'consent' });
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
    if (tokenString) {
        try {
            const token = JSON.parse(tokenString);
            gapi.client.setToken(token);
            return true;
        } catch (e) {
            console.error("Invalid stored token", e);
            localStorage.removeItem('google_calendar_token');
            return false;
        }
    }
    return false;
}

/**
 * List events for a specific day.
 * @param {Date} date - The date to fetch events for.
 */
export async function listEventsForDay(date) {
    if (!gapiInited) throw new Error("GAPI not initialized");

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
        const request = {
            'calendarId': 'primary',
            'timeMin': startOfDay.toISOString(),
            'timeMax': endOfDay.toISOString(),
            'showDeleted': false,
            'singleEvents': true,
            'maxResults': 50,
            'orderBy': 'startTime',
        };
        const response = await gapi.client.calendar.events.list(request);
        return response.result.items;
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

export function isReady() {
    return gapiInited && gisInited;
}
