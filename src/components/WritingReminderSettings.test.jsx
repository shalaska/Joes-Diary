// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../contexts/authContext';

const service = vi.hoisted(() => ({
    loadReminderSettings: vi.fn(),
    reminderBlocker: vi.fn(),
    enableReminders: vi.fn(async () => 'token'),
    disableReminders: vi.fn(async () => {}),
    sendTestReminder: vi.fn(async () => ({ sent: true })),
    setReminderDays: vi.fn(async () => {}),
}));
vi.mock('../services/reminders', () => service);

import WritingReminderSettings from './WritingReminderSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
const mount = async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<AuthContext.Provider value={{ currentUser: { uid: 'joe' } }}><WritingReminderSettings /></AuthContext.Provider>));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const button = (text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text));

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.clearAllMocks();
});

describe('WritingReminderSettings', () => {
    it('tells an iPhone user to add the diary to the Home Screen first', async () => {
        service.loadReminderSettings.mockResolvedValue({ enabled: false, afterDays: 2, tokens: [] });
        service.reminderBlocker.mockResolvedValue('add-to-home-screen');
        await mount();
        expect(host.textContent).toContain('Add to Home Screen');
        expect(button('Turn on')).toBeUndefined();
    });

    it('turns reminders on for this device with the chosen days, then offers a test', async () => {
        service.loadReminderSettings.mockResolvedValue({ enabled: false, afterDays: 3, tokens: [] });
        service.reminderBlocker.mockResolvedValue('');
        await mount();
        await act(async () => button('Turn on').click());
        expect(service.enableReminders).toHaveBeenCalledWith('joe', 3);
        expect(host.textContent).toContain('Reminders are on for this device.');
        await act(async () => button('Send a test').click());
        expect(service.sendTestReminder).toHaveBeenCalled();
    });

    it('explains blocked notifications when permission is refused', async () => {
        service.loadReminderSettings.mockResolvedValue({ enabled: false, afterDays: 2, tokens: [] });
        service.reminderBlocker.mockResolvedValue('');
        service.enableReminders.mockRejectedValueOnce(new Error('permission'));
        await mount();
        await act(async () => button('Turn on').click());
        expect(host.textContent).toContain('Notifications are blocked');
    });

    it('turns reminders off', async () => {
        service.loadReminderSettings.mockResolvedValue({ enabled: true, afterDays: 2, tokens: ['t'] });
        service.reminderBlocker.mockResolvedValue('');
        await mount();
        await act(async () => button('Turn off').click());
        expect(service.disableReminders).toHaveBeenCalledWith('joe');
        expect(button('Turn on')).toBeDefined();
    });
});
