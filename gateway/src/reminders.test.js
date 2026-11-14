import { describe, expect, it } from 'vitest';
import { checkReminders, createSender, lastWrittenDay, reminderMessage, sendTestReminder } from './reminders.js';

const NOW = Date.parse('2026-11-14T20:00:00.000Z'); // Saturday, 8pm in London

const setup = (users) => {
    const saved = [];
    const removed = [];
    const store = {
        allowedUids: async () => Object.keys(users),
        settings: async (uid) => users[uid].settings ?? null,
        recentEntries: async (uid) => users[uid].entries,
        saveSettings: async (uid, fields) => { saved.push([uid, fields]); users[uid].settings = { ...users[uid].settings, ...fields }; },
        removeTokens: async (uid, tokens) => { removed.push([uid, tokens]); },
    };
    const sent = [];
    const send = async (tokens, message) => { sent.push({ tokens, message }); return tokens.map(token => ({ token, ok: token !== 'dead', invalid: token === 'dead' })); };
    return { store, send, sent, saved, removed };
};

const entry = (day, extra = {}) => ({ date: `${day}T09:00:00.000Z`, content: 'something', ...extra });
const on = (extra = {}) => ({ enabled: true, afterDays: 2, tokens: ['phone'], ...extra });

describe('writing reminders', () => {
    it('finds the last day with a note, ignoring saved reviews and empty entries', () => {
        expect(lastWrittenDay([entry('2026-11-10'), entry('2026-11-13', { type: 'analysis' }), entry('2026-11-12', { content: '<p> </p>' }), entry('2026-11-11')])).toBe('2026-11-11');
        expect(lastWrittenDay([])).toBeNull();
    });

    it('reminds after the chosen number of days, without any diary text', async () => {
        const ctx = setup({ joe: { settings: on(), entries: [entry('2026-11-12')] } });
        const counts = await checkReminders({ ...ctx, now: () => NOW });
        expect(counts).toMatchObject({ users: 1, due: 1, sent: 1 });
        expect(ctx.sent).toEqual([{ tokens: ['phone'], message: reminderMessage(2) }]);
        expect(ctx.sent[0].message.body).not.toContain('something');
        expect(ctx.saved).toEqual([['joe', { lastRemindedDay: '2026-11-14' }]]);
    });

    it('stays quiet when the user wrote recently, turned it off, has no device, or never wrote', async () => {
        const ctx = setup({
            recent: { settings: on(), entries: [entry('2026-11-13')] },
            off: { settings: on({ enabled: false }), entries: [entry('2026-11-01')] },
            noDevice: { settings: on({ tokens: [] }), entries: [entry('2026-11-01')] },
            never: { settings: on(), entries: [] },
            unset: { entries: [entry('2026-11-01')] },
        });
        await checkReminders({ ...ctx, now: () => NOW });
        expect(ctx.sent).toEqual([]);
    });

    it('does not nag: after a reminder it waits another afterDays, and resets once the user writes', async () => {
        const ctx = setup({ joe: { settings: on({ lastRemindedDay: '2026-11-13' }), entries: [entry('2026-11-10')] } });
        await checkReminders({ ...ctx, now: () => NOW });
        expect(ctx.sent).toEqual([]);
        await checkReminders({ ...ctx, now: () => NOW + 864e5 });
        expect(ctx.sent).toHaveLength(1);
        expect(ctx.sent[0].message.body).toMatch(/5 days/);

        // Wrote on the 16th, then went quiet again: the old reminder date does not block a new one.
        const later = setup({ joe: { settings: on({ lastRemindedDay: '2026-11-15' }), entries: [entry('2026-11-16')] } });
        await checkReminders({ ...later, now: () => Date.parse('2026-11-18T20:00:00.000Z') });
        expect(later.sent).toHaveLength(1);
    });

    it('drops devices that no longer exist and counts a send to none as failed', async () => {
        const ctx = setup({ joe: { settings: on({ tokens: ['dead'] }), entries: [entry('2026-11-01')] } });
        const counts = await checkReminders({ ...ctx, now: () => NOW });
        expect(ctx.removed).toEqual([['joe', ['dead']]]);
        expect(counts).toMatchObject({ sent: 0, failed: 1, removedTokens: 1 });
        expect(ctx.saved).toEqual([]);
    });

    it('logs counts only', async () => {
        const logs = [];
        const ctx = setup({ joe: { settings: on(), entries: [entry('2026-11-01')] } });
        await checkReminders({ ...ctx, now: () => NOW, log: (e) => logs.push(e) });
        expect(logs).toEqual([{ feature: 'reminders', users: 1, due: 1, sent: 1, failed: 0, removedTokens: 0 }]);
    });

    it('sends a test to every device without changing when the last reminder was', async () => {
        const ctx = setup({ joe: { settings: on({ tokens: ['phone', 'laptop'] }), entries: [] } });
        expect(await sendTestReminder({ ...ctx, uid: 'joe' })).toEqual({ sent: true, devices: 2 });
        expect(ctx.saved).toEqual([]);
        const none = setup({ joe: { settings: on({ enabled: false }), entries: [] } });
        expect((await sendTestReminder({ ...none, uid: 'joe' })).sent).toBe(false);
    });

    it('sends data-only web pushes and marks gone tokens', async () => {
        let request;
        const messaging = {
            sendEachForMulticast: async (r) => {
                request = r;
                return { responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }, { success: false, error: { code: 'messaging/internal-error' } }] };
            },
        };
        const results = await createSender(messaging)(['a', 'b', 'c'], reminderMessage(3));
        expect(request.notification).toBeUndefined();
        expect(request.data).toEqual({ title: 'JoesDiary', body: reminderMessage(3).body, link: '/' });
        expect(results).toEqual([{ token: 'a', ok: true, invalid: false }, { token: 'b', ok: false, invalid: true }, { token: 'c', ok: false, invalid: false }]);
    });
});
