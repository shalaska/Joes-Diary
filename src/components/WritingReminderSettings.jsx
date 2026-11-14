import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Send } from 'lucide-react';
import { useAuth } from '../contexts/authContext';
import { disableReminders, enableReminders, loadReminderSettings, reminderBlocker, sendTestReminder, setReminderDays } from '../services/reminders';

const BLOCKERS = {
    'not-configured': 'Reminders are not set up for this diary yet.',
    'add-to-home-screen': 'On iPhone, first add the diary to your Home Screen: tap Share, then "Add to Home Screen". Open it from there and turn this on.',
    unsupported: 'This browser cannot show notifications. Try the diary from your phone\'s Home Screen.',
    denied: 'Notifications are blocked for the diary. Allow them in your phone or browser settings, then come back.',
};

// "Remind me to write": a phone notification in the evening after a few days without an entry.
// The evening check runs on the server (gateway/src/reminders.js); this only switches it on
// for this device. A reminder never contains diary text.
const WritingReminderSettings = () => {
    const uid = useAuth()?.currentUser?.uid;
    const [settings, setSettings] = useState(null);
    const [blocker, setBlocker] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!uid) return undefined;
        let live = true;
        Promise.all([loadReminderSettings(uid), reminderBlocker()])
            .then(([loaded, why]) => { if (live) { setSettings(loaded); setBlocker(why); } })
            .catch(() => live && setMessage('Could not load reminder settings.'));
        return () => { live = false; };
    }, [uid]);

    if (!uid) return null;

    const run = async (action, done) => {
        setBusy(true);
        setMessage('');
        try {
            await action();
            setMessage(done);
        } catch (error) {
            setMessage(error?.message === 'permission' ? BLOCKERS.denied : 'That did not work. Try again.');
        }
        setBusy(false);
    };

    const enabled = Boolean(settings?.enabled);
    const afterDays = settings?.afterDays || 2;

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                Writing reminder
            </h3>
            <p className="text-sm text-slate-600">
                A notification at 8pm when you haven&apos;t written for a while. It never shows anything you wrote.
            </p>

            {blocker && !enabled ? (
                <p className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-lg p-3">{BLOCKERS[blocker]}</p>
            ) : (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={busy || !settings}
                            onClick={() => (enabled
                                ? run(async () => { await disableReminders(uid); setSettings(s => ({ ...s, enabled: false })); }, 'Reminders are off.')
                                : run(async () => { await enableReminders(uid, afterDays); setSettings(s => ({ ...s, enabled: true })); }, 'Reminders are on for this device.'))}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${enabled ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                        >
                            {enabled ? <BellOff size={16} /> : <Bell size={16} />}
                            {enabled ? 'Turn off' : 'Turn on for this device'}
                        </button>
                        {enabled && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => run(sendTestReminder, 'Test sent. It should arrive in a few seconds.')}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                <Send size={16} />
                                Send a test
                            </button>
                        )}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        Remind me after
                        <select
                            value={afterDays}
                            disabled={busy || !settings}
                            onChange={(e) => {
                                const days = Number(e.target.value);
                                setSettings(s => ({ ...s, afterDays: days }));
                                setReminderDays(uid, days).catch(() => setMessage('Could not save that.'));
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-200 bg-white"
                        >
                            {[1, 2, 3, 5, 7].map(d => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}
                        </select>
                        without writing
                    </label>
                </div>
            )}
            {message && <p className="text-sm text-slate-600">{message}</p>}
        </div>
    );
};

export default WritingReminderSettings;
