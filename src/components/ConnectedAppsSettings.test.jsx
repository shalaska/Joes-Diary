// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../contexts/authContext';
import ConnectedAppsSettings from './ConnectedAppsSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { email: 'joe@example.com', getIdToken: async () => 'id-token' };
const CONNECTION = { id: 'g1', clientName: 'Claude', redirectHost: 'claude.ai', scopes: ['diary.read', 'diary.suggest'], createdAt: 1, lastUsedAt: Date.parse('2026-11-13T10:00:00Z') };

let root;
let host;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const mount = async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<AuthContext.Provider value={{ currentUser: USER }}><ConnectedAppsSettings /></AuthContext.Provider>));
    await flush();
};

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
});

describe('ConnectedAppsSettings', () => {
    it('lists connections with what they may do, and revokes one', async () => {
        const calls = [];
        globalThis.fetch = vi.fn(async (path, init) => {
            calls.push({ path, body: JSON.parse(init.body) });
            const data = path === '/oauth/connections' ? { connections: [CONNECTION] } : { revoked: true };
            return { ok: true, json: async () => data };
        });
        await mount();
        expect(host.textContent).toContain('Claude');
        expect(host.textContent).toContain('Read + Suggest · via claude.ai');
        expect(host.querySelector('input').value).toBe('https://joesdiary-d8211.web.app/mcp');

        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Revoke')).click());
        await flush();
        expect(calls[1]).toEqual({ path: '/oauth/connections/revoke', body: { idToken: 'id-token', id: 'g1' } });
        expect(host.textContent).toContain('No apps are connected.');
    });

    it('says so when the list cannot load', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'login_required' }) }));
        await mount();
        expect(host.textContent).toContain('Could not load connected apps.');
    });
});
