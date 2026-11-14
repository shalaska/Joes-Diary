// Writing reminders on this device: asks for notification permission, registers the
// reminder service worker, and stores this device's push token in
// users/{uid}/settings/reminders, where the evening check (gateway/src/reminders.js) finds it.
import { arrayRemove, arrayUnion, doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, db } from '../firebase';

// The Web Push certificate's public key (Firebase console > Project settings > Cloud
// Messaging). It is public by design: browsers use it to check pushes come from this project.
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

const settingsRef = (uid) => doc(db, 'users', uid, 'settings', 'reminders');

// Why reminders cannot be turned on here, or '' when they can.
export const reminderBlocker = async ({ win = window, supported = isSupported } = {}) => {
    if (!VAPID_KEY) return 'not-configured';
    const standalone = win.matchMedia?.('(display-mode: standalone)')?.matches || win.navigator?.standalone === true;
    const ios = /iPhone|iPad|iPod/.test(win.navigator?.userAgent || '');
    if (ios && !standalone) return 'add-to-home-screen';
    if (!('Notification' in win) || !('serviceWorker' in (win.navigator || {})) || !(await supported())) return 'unsupported';
    if (win.Notification.permission === 'denied') return 'denied';
    return '';
};

export const loadReminderSettings = async (uid) => {
    const snapshot = await getDoc(settingsRef(uid));
    return snapshot.exists() ? snapshot.data() : { enabled: false, afterDays: 2, tokens: [] };
};

const deviceToken = async () => {
    const registration = await navigator.serviceWorker.register('/reminder-sw.js');
    await navigator.serviceWorker.ready;
    return getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
};

export const enableReminders = async (uid, afterDays = 2) => {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('permission');
    const token = await deviceToken();
    await setDoc(settingsRef(uid), { enabled: true, afterDays, tokens: arrayUnion(token), updatedAt: new Date().toISOString() }, { merge: true });
    return token;
};

export const setReminderDays = (uid, afterDays) => setDoc(settingsRef(uid), { afterDays }, { merge: true });

// Turns reminders off everywhere, and forgets this device's token.
export const disableReminders = async (uid) => {
    let token = null;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            token = await deviceToken();
            await deleteToken(getMessaging(app));
        } catch {
            token = null;
        }
    }
    await setDoc(settingsRef(uid), { enabled: false, ...(token ? { tokens: arrayRemove(token) } : {}), updatedAt: new Date().toISOString() }, { merge: true });
};

// Sends one reminder to every device now, so the user can see what it looks like.
export const sendTestReminder = async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const { data } = await httpsCallable(getFunctions(app, 'europe-west1'), 'reminderTest')({});
    return data;
};
