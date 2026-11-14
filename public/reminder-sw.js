// Shows the diary's writing reminders. The server sends data-only Firebase Cloud Messaging
// messages ({ title, body, link }); this worker turns each into a notification and opens
// the diary when it is tapped. A reminder never carries diary text.
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {};
    }
    const data = payload.data || payload.notification || payload;
    const title = data.title || 'JoesDiary';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || 'A few minutes to write today?',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'writing-reminder',
        data: { link: data.link || '/' },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = new URL(event.notification.data?.link || '/', self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
        const open = windows.find(w => w.url.startsWith(self.location.origin));
        return open ? open.focus() : self.clients.openWindow(link);
    }));
});
