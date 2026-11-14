// Writing reminders (the "heads-up" when the user has not written for a while). Once every
// evening the scheduled function runs checkReminders: for each allowed user who switched
// reminders on, if their last entry is at least afterDays old, their devices get one push
// notification, and then no more until another afterDays have passed.
//
// A reminder carries no diary text: only how many days it has been. It goes through
// Firebase Cloud Messaging and the phone's push service, so nothing private should be in it.
import { dayOf } from './agent.js';
import { todayIn } from './mcpTools.js';

const DAY_MS = 864e5;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const reminderMessage = (days) => ({
    title: 'JoesDiary',
    body: days >= 7
        ? `It's been ${days} days since you last wrote. Even one line tonight counts.`
        : `It's been ${days} days since you last wrote. A few minutes tonight?`,
    link: '/',
});

// The newest day with a note, ignoring saved reviews. entries: newest first is fine, any order works.
export const lastWrittenDay = (entries) => entries
    .filter(e => e.type !== 'analysis' && String(e.content || '').replace(/<[^>]+>/g, '').trim())
    .map(dayOf)
    .sort()
    .pop() || null;

/**
 * store: { allowedUids(), settings(uid), recentEntries(uid), saveSettings(uid, fields), removeTokens(uid, tokens) }
 * send(tokens, message) -> [{ token, ok, invalid }]
 * Returns counts for the log line. No uids, no text.
 */
export const checkReminders = async ({ store, send, now = () => Date.now(), log = () => {} }) => {
    const today = todayIn(now());
    const counts = { users: 0, due: 0, sent: 0, failed: 0, removedTokens: 0 };
    for (const uid of await store.allowedUids()) {
        const settings = await store.settings(uid);
        if (!settings?.enabled || !settings.tokens?.length) continue;
        counts.users += 1;
        const last = lastWrittenDay(await store.recentEntries(uid));
        if (!last) continue;
        const afterDays = Math.max(1, Number(settings.afterDays) || 2);
        const days = daysBetween(last, today);
        if (days < afterDays) continue;
        if (settings.lastRemindedDay && settings.lastRemindedDay > last && daysBetween(settings.lastRemindedDay, today) < afterDays) continue;
        counts.due += 1;
        const results = await send(settings.tokens, reminderMessage(days));
        const invalid = results.filter(r => r.invalid).map(r => r.token);
        if (invalid.length) {
            await store.removeTokens(uid, invalid);
            counts.removedTokens += invalid.length;
        }
        if (results.some(r => r.ok)) {
            counts.sent += 1;
            await store.saveSettings(uid, { lastRemindedDay: today });
        } else {
            counts.failed += 1;
        }
    }
    log({ feature: 'reminders', ...counts });
    return counts;
};

// "Send a test" in Settings: one reminder to this user's devices now, without changing state.
export const sendTestReminder = async ({ store, send, uid }) => {
    const settings = await store.settings(uid);
    if (!settings?.enabled || !settings.tokens?.length) return { sent: false, reason: 'Reminders are not on for any device.' };
    const results = await send(settings.tokens, { title: 'JoesDiary', body: 'This is a test reminder. This is how a nudge to write will look.', link: '/' });
    const invalid = results.filter(r => r.invalid).map(r => r.token);
    if (invalid.length) await store.removeTokens(uid, invalid);
    return { sent: results.some(r => r.ok), devices: results.filter(r => r.ok).length };
};

// Firestore side. Settings live in users/{uid}/settings/reminders (the user's own document);
// the allowlist decides who is checked at all.
export const createReminderStore = (db, FieldValue) => ({
    allowedUids: async () => (await db.collection('allowedUsers').get()).docs.map(d => d.id),
    settings: async (uid) => (await db.doc(`users/${uid}/settings/reminders`).get()).data() ?? null,
    recentEntries: async (uid) => (await db.collection(`users/${uid}/entries`).orderBy('date', 'desc').limit(20).get()).docs.map(d => d.data()),
    saveSettings: async (uid, fields) => { await db.doc(`users/${uid}/settings/reminders`).set(fields, { merge: true }); },
    removeTokens: async (uid, tokens) => { await db.doc(`users/${uid}/settings/reminders`).set({ tokens: FieldValue.arrayRemove(...tokens) }, { merge: true }); },
});

// Firebase Cloud Messaging side: a data-only web push, which the reminder service worker shows.
const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
export const createSender = (messaging) => async (tokens, message) => {
    const response = await messaging.sendEachForMulticast({
        tokens,
        data: { title: message.title, body: message.body, link: message.link },
        webpush: { headers: { TTL: String(6 * 3600), Urgency: 'normal' } },
    });
    return response.responses.map((r, i) => ({ token: tokens[i], ok: r.success, invalid: !r.success && GONE.has(r.error?.code) }));
};
