// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../contexts/authContext';

vi.mock('../firebase', () => ({ auth: {} }));

import { ConnectConsent } from './ConnectPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PARAMS = { client_id: 'https://claude.ai/oauth/claude-code-client-metadata', redirect_uri: 'http://localhost:5000/callback', state: 's' };
const CHECK_OK = { ok: true, client: { name: 'Claude Code' }, redirectHost: 'localhost', scopes: ['diary.read'], optionalScopes: ['diary.suggest'] };
const USER = { email: 'joe@example.com', getIdToken: async () => 'id-token' };

let root;
let host;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const mount = async (element) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(element));
    await flush();
    return host;
};
const button = (name) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name);
const withUser = (user, element) => <AuthContext.Provider value={{ currentUser: user, login: vi.fn(), logout: vi.fn() }}>{element}</AuthContext.Provider>;

const mockFetch = (routes) => {
    const calls = [];
    globalThis.fetch = vi.fn(async (path, init) => {
        const body = JSON.parse(init.body);
        calls.push({ path, body });
        const [status, data] = routes[path](body);
        return { ok: status < 400, status, json: async () => data };
    });
    return calls;
};

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
});

describe('ConnectPage', () => {
    it('shows who is asking, where it goes back to, and what it may and may not do', async () => {
        mockFetch({ '/oauth/authorize/check': () => [200, CHECK_OK] });
        await mount(withUser(USER, <ConnectConsent params={PARAMS} navigate={vi.fn()} />));
        expect(host.textContent).toContain('Connect Claude Code to your diary?');
        expect(host.textContent).toContain('send you back to localhost');
        expect(host.textContent).toContain('never edit or delete what you wrote');
        expect([...host.querySelectorAll('input[type=checkbox]')].map(c => c.checked)).toEqual([false, false]);
        expect(host.querySelector('input[type=checkbox]').checked).toBe(false);
    });

    it('sends Allow with the suggest tickbox and the user\'s sign-in, then follows the redirect', async () => {
        const calls = mockFetch({
            '/oauth/authorize/check': () => [200, CHECK_OK],
            '/oauth/authorize': () => [200, { redirect: 'http://localhost:5000/callback?code=c&state=s' }],
        });
        const navigate = vi.fn();
        await mount(withUser(USER, <ConnectConsent params={PARAMS} navigate={navigate} />));
        await act(async () => host.querySelector('input[type=checkbox]').click());
        await act(async () => button('Allow').click());
        await flush();
        expect(calls[1]).toEqual({ path: '/oauth/authorize', body: { params: PARAMS, idToken: 'id-token', approved: true, suggest: true, change: false } });
        expect(navigate).toHaveBeenCalledWith('http://localhost:5000/callback?code=c&state=s');
    });

    it('sends Deny without suggestions', async () => {
        const calls = mockFetch({
            '/oauth/authorize/check': () => [200, CHECK_OK],
            '/oauth/authorize': () => [200, { redirect: 'http://localhost:5000/callback?error=access_denied' }],
        });
        await mount(withUser(USER, <ConnectConsent params={PARAMS} navigate={vi.fn()} />));
        await act(async () => host.querySelector('input[type=checkbox]').click());
        await act(async () => button('Deny').click());
        await flush();
        expect(calls[1].body).toMatchObject({ approved: false, suggest: false, change: false });
    });

    it('shows the server\'s refusal for an account not on the allowlist', async () => {
        mockFetch({
            '/oauth/authorize/check': () => [200, CHECK_OK],
            '/oauth/authorize': () => [403, { error: 'access_denied', error_description: 'This account is not allowed to use the diary.' }],
        });
        const navigate = vi.fn();
        await mount(withUser(USER, <ConnectConsent params={PARAMS} navigate={navigate} />));
        await act(async () => button('Allow').click());
        await flush();
        expect(host.textContent).toContain('This account is not allowed to use the diary.');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('shows an error and no buttons for an app the diary refuses', async () => {
        mockFetch({ '/oauth/authorize/check': () => [400, { ok: false, error: 'This app is not allowed to connect to your diary.' }] });
        await mount(withUser(USER, <ConnectConsent params={PARAMS} navigate={vi.fn()} />));
        expect(host.textContent).toContain('This app is not allowed to connect to your diary.');
        expect(button('Allow')).toBeUndefined();
    });

    it('asks a signed-out user to log in before showing the consent', async () => {
        mockFetch({ '/oauth/authorize/check': () => [200, CHECK_OK] });
        await mount(withUser(null, <ConnectConsent params={PARAMS} navigate={vi.fn()} />));
        expect(host.textContent).toContain('Log In');
        expect(button('Allow')).toBeUndefined();
    });
});
