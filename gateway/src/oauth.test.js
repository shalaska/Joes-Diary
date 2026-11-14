import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createConnectorHandler, sendWebResponse, toWebRequest } from './connector.js';
import { createMcpHandler } from './mcp.js';
import { createOAuth, isClaudeRedirect } from './oauth.js';
import { createOAuthStore } from './store.js';

const BASE = 'https://diary.test';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CIMD_URL = 'https://claude.ai/oauth/claude-code-client-metadata';
const VERIFIER = 'a'.repeat(20) + 'b'.repeat(23); // 43 characters
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

// In memory, with the same "used once" semantics as the Firestore store.
const memoryStore = () => {
    const t = { clients: new Map(), codes: new Map(), tokens: new Map(), grants: new Map() };
    const markUsed = (map, hash) => {
        const doc = map.get(hash);
        if (!doc) return null;
        if (doc.used) return { doc, firstUse: false };
        map.set(hash, { ...doc, used: true });
        return { doc, firstUse: true };
    };
    const store = {
        getClient: async (id) => t.clients.get(id) ?? null,
        saveClient: async (id, doc) => { t.clients.set(id, doc); },
        saveCode: async (hash, doc) => { t.codes.set(hash, doc); },
        useCode: async (hash) => markUsed(t.codes, hash),
        saveToken: async (hash, doc) => { t.tokens.set(hash, doc); },
        getToken: async (hash) => t.tokens.get(hash) ?? null,
        useToken: async (hash) => markUsed(t.tokens, hash),
        getGrant: async (id) => t.grants.get(id) ?? null,
        listGrants: async (uid) => [...t.grants].filter(([, g]) => g.uid === uid).map(([id, g]) => ({ id, ...g })),
        saveGrant: async (id, doc) => { t.grants.set(id, doc); },
        updateGrant: async (id, fields) => {
            if (!t.grants.has(id)) throw new Error('NOT_FOUND');
            t.grants.set(id, { ...t.grants.get(id), ...fields });
        },
        deleteGrant: async (id) => {
            t.grants.delete(id);
            for (const map of [t.tokens, t.codes]) for (const [k, v] of map) if (v.grantId === id) map.delete(k);
        },
    };
    return { t, store };
};

const setup = ({ allowed = ['joe'], clock = { t: Date.parse('2026-11-13T10:00:00.000Z') }, metadata } = {}) => {
    const { t, store } = memoryStore();
    const allowedUsers = new Set(allowed);
    const fetched = [];
    const logs = [];
    const oauth = createOAuth({
        base: BASE,
        store,
        verifyIdToken: async (idToken) => {
            if (!idToken.startsWith('id-')) throw new Error('bad token');
            return idToken.slice(3);
        },
        isAllowedUser: async (uid) => allowedUsers.has(uid),
        fetchClientMetadata: async (url) => {
            fetched.push(url);
            return metadata ?? { client_id: url, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'] };
        },
        now: () => clock.t,
        log: (e) => logs.push(e),
    });
    return { oauth, t, allowedUsers, clock, fetched, logs };
};

const authParams = (overrides = {}) => ({
    response_type: 'code',
    client_id: CIMD_URL,
    redirect_uri: 'http://localhost:53682/callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${BASE}/mcp`,
    scope: 'diary.read',
    ...overrides,
});

// Runs the consent step and returns the code from the redirect.
const getCode = async (oauth, { params = authParams(), idToken = 'id-joe', suggest = false } = {}) => {
    const result = await oauth.authorize({ params, idToken, approved: true, suggest });
    expect(result.status).toBe(200);
    const redirect = new URL(result.body.redirect);
    return { code: redirect.searchParams.get('code'), redirect };
};

const exchange = (oauth, code, overrides = {}) => oauth.token({
    grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:53682/callback', client_id: CIMD_URL, code_verifier: VERIFIER, resource: `${BASE}/mcp`, ...overrides,
});

const bearer = (token) => new Request(`${BASE}/mcp`, { headers: { Authorization: `Bearer ${token}` } });

describe('sign-in metadata', () => {
    it('publishes resource and server metadata that Claude can use for metadata-document clients', async () => {
        const { oauth } = setup();
        const handler = createConnectorHandler({ oauth, mcp: async () => new Response('mcp') });
        const resource = await (await handler(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`))).json();
        expect(resource).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
        const server = await (await handler(new Request(`${BASE}/.well-known/oauth-authorization-server`))).json();
        expect(server).toMatchObject({
            issuer: BASE,
            authorization_endpoint: `${BASE}/connect`,
            token_endpoint: `${BASE}/oauth/token`,
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            client_id_metadata_document_supported: true,
            authorization_response_iss_parameter_supported: true,
        });
        expect((await handler(new Request(`${BASE}/.well-known/openid-configuration`))).status).toBe(404);
        expect((await handler(new Request(`${BASE}/oauth/token`))).status).toBe(405);
    });
});

describe('who may connect', () => {
    it('accepts only Claude\'s redirect addresses', () => {
        expect(isClaudeRedirect(CLAUDE)).toBe(true);
        expect(isClaudeRedirect('http://localhost:61234/callback')).toBe(true);
        expect(isClaudeRedirect('http://127.0.0.1:8080/callback')).toBe(true);
        expect(isClaudeRedirect('https://evil.example/api/mcp/auth_callback')).toBe(false);
        expect(isClaudeRedirect('https://claude.ai.evil.example/api/mcp/auth_callback')).toBe(false);
        expect(isClaudeRedirect('http://localhost:61234/steal')).toBe(false);
        expect(isClaudeRedirect('https://localhost/callback')).toBe(false);
    });

    it('registers a client only with Claude\'s redirect', async () => {
        const { oauth, t } = setup();
        const refused = await oauth.register({ redirect_uris: ['https://evil.example/cb'], client_name: 'Evil' });
        expect(refused).toMatchObject({ status: 400, body: { error: 'invalid_redirect_uri' } });
        const ok = await oauth.register({ redirect_uris: [CLAUDE], client_name: 'Claude', token_endpoint_auth_method: 'client_secret_post' });
        expect(ok.status).toBe(201);
        expect(ok.body).toMatchObject({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
        expect(t.clients.size).toBe(1);
        const check = await oauth.checkAuthorization(authParams({ client_id: ok.body.client_id, redirect_uri: CLAUDE }));
        expect(check).toMatchObject({ ok: true, client: { name: 'Claude' }, redirectHost: 'claude.ai' });
    });

    it('trusts metadata documents only from Claude\'s hosts, and only for their own redirects', async () => {
        const { oauth, fetched } = setup();
        expect(await oauth.checkAuthorization(authParams({ client_id: 'https://evil.example/client.json' }))).toMatchObject({ ok: false });
        expect(fetched).toEqual([]);
        expect(await oauth.checkAuthorization(authParams({ redirect_uri: CLAUDE }))).toMatchObject({ ok: false });
        expect(await oauth.checkAuthorization(authParams())).toMatchObject({ ok: true, client: { name: 'Claude Code' }, redirectHost: 'localhost' });
    });

    it('refuses a metadata document whose client_id is not its own address', async () => {
        const { oauth } = setup({ metadata: { client_id: 'https://claude.ai/other', redirect_uris: ['http://localhost/callback'] } });
        expect(await oauth.checkAuthorization(authParams())).toMatchObject({ ok: false });
    });

    it('never redirects for a bad client, and sends other problems back to the client', async () => {
        const { oauth } = setup();
        const badClient = await oauth.checkAuthorization(authParams({ client_id: 'unknown' }));
        expect(badClient.redirect).toBeUndefined();
        const noPkce = await oauth.checkAuthorization(authParams({ code_challenge_method: 'plain' }));
        expect(noPkce.ok).toBe(false);
        expect(new URL(noPkce.redirect).searchParams.get('error')).toBe('invalid_request');
        const otherResource = await oauth.checkAuthorization(authParams({ resource: 'https://other.example/mcp' }));
        expect(new URL(otherResource.redirect).searchParams.get('error')).toBe('invalid_target');
    });

    it('refuses a stranger at consent, even when signed in', async () => {
        const { oauth, t } = setup();
        const result = await oauth.authorize({ params: authParams(), idToken: 'id-stranger', approved: true });
        expect(result).toMatchObject({ status: 403, body: { error: 'access_denied' } });
        expect((await oauth.authorize({ params: authParams(), idToken: 'forged', approved: true })).status).toBe(401);
        expect(t.grants.size).toBe(0);
        expect(t.codes.size).toBe(0);
    });

    it('sends access_denied back when the user taps Deny', async () => {
        const { oauth, t } = setup();
        const result = await oauth.authorize({ params: authParams(), idToken: 'id-joe', approved: false });
        const redirect = new URL(result.body.redirect);
        expect(redirect.searchParams.get('error')).toBe('access_denied');
        expect(redirect.searchParams.get('state')).toBe('xyz');
        expect(t.grants.size).toBe(0);
    });
});

describe('the full flow', () => {
    it('goes from consent to a working MCP call, with PKCE, state and iss', async () => {
        const { oauth, t } = setup();
        const { code, redirect } = await getCode(oauth);
        expect(redirect.origin + redirect.pathname).toBe('http://localhost:53682/callback');
        expect(redirect.searchParams.get('state')).toBe('xyz');
        expect(redirect.searchParams.get('iss')).toBe(BASE);

        const tokens = await exchange(oauth, code);
        expect(tokens.status).toBe(200);
        expect(tokens.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'diary.read' });

        // Only hashes are stored.
        const stored = JSON.stringify([...t.tokens.entries(), ...t.codes.entries()]);
        expect(stored).not.toContain(tokens.body.access_token);
        expect(stored).not.toContain(tokens.body.refresh_token);
        expect(stored).not.toContain(code);

        expect(await oauth.authenticate(bearer(tokens.body.access_token))).toMatchObject({ uid: 'joe', scopes: ['diary.read'] });
    });

    it('drives the real MCP server through the connector handler with an issued token', async () => {
        const { oauth } = setup();
        const { code } = await getCode(oauth, { suggest: true });
        const { body } = await exchange(oauth, code);
        const store = { entries: async () => [], todos: async () => [{ text: 'Book dentist', priority: 'high', completed: false }], saveProposals: async () => [], pendingProposalCount: async () => 0 };
        const handler = createConnectorHandler({ oauth, mcp: createMcpHandler({ authenticate: oauth.authenticate, storeFor: () => store }) });
        const client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${body.access_token}` } },
            fetch: (url, init) => handler(new Request(url, init)),
        }));
        const { tools } = await client.listTools();
        expect(tools.map(tool => tool.name)).toContain('propose_todo');
        const todos = await client.callTool({ name: 'list_todos', arguments: {} });
        expect(todos.content[0].text).toContain('Book dentist');
        await client.close();
    });

    it('gives suggestions only when the user ticked them', async () => {
        const { oauth } = setup();
        const readOnly = await exchange(oauth, (await getCode(oauth)).code);
        expect(readOnly.body.scope).toBe('diary.read');
        const withSuggest = await exchange(oauth, (await getCode(oauth, { suggest: true })).code);
        expect(withSuggest.body.scope).toBe('diary.read diary.suggest');
        const getCodeWith = async (extra) => (await oauth.authorize({ params: authParams(), idToken: 'id-joe', approved: true, ...extra })).body.redirect;
        const withChange = await exchange(oauth, new URL(await getCodeWith({ change: true })).searchParams.get('code'));
        expect(withChange.body.scope).toBe('diary.read diary.change');
        const truthy = await exchange(oauth, new URL(await getCodeWith({ change: 'yes', suggest: 1 })).searchParams.get('code'));
        expect(truthy.body.scope).toBe('diary.read');
    });

    it('accepts the token request as a form, as Claude sends it', async () => {
        const { oauth } = setup();
        const { code } = await getCode(oauth);
        const handler = createConnectorHandler({ oauth, mcp: async () => null });
        const response = await handler(new Request(`${BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:53682/callback', client_id: CIMD_URL, code_verifier: VERIFIER }).toString(),
        }));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await response.json()).access_token).toMatch(/^jda_/);
    });
});

describe('codes', () => {
    it('refuses a wrong PKCE verifier, client or redirect', async () => {
        const { oauth } = setup();
        expect((await exchange(oauth, (await getCode(oauth)).code, { code_verifier: 'c'.repeat(43) })).body.error).toBe('invalid_grant');
        expect((await exchange(oauth, (await getCode(oauth)).code, { client_id: 'https://claude.ai/other' })).body.error).toBe('invalid_grant');
        expect((await exchange(oauth, (await getCode(oauth)).code, { redirect_uri: 'http://localhost:1/callback' })).body.error).toBe('invalid_grant');
    });

    it('refuses a token for another resource', async () => {
        const { oauth } = setup();
        const result = await exchange(oauth, (await getCode(oauth)).code, { resource: 'https://other.example/mcp' });
        expect(result.body.error).toBe('invalid_target');
    });

    it('expires after five minutes', async () => {
        const { oauth, clock } = setup();
        const { code } = await getCode(oauth);
        clock.t += 301_000;
        expect((await exchange(oauth, code)).body.error).toBe('invalid_grant');
    });

    it('ends the connection when a code is used twice', async () => {
        const { oauth, t } = setup();
        const { code } = await getCode(oauth);
        const first = await exchange(oauth, code);
        expect(first.status).toBe(200);
        expect((await exchange(oauth, code)).body.error).toBe('invalid_grant');
        expect(t.grants.size).toBe(0);
        expect(await oauth.authenticate(bearer(first.body.access_token))).toBeNull();
    });
});

describe('tokens', () => {
    const connect = async (ctx) => (await exchange(ctx.oauth, (await getCode(ctx.oauth)).code)).body;

    it('expires an access token after an hour', async () => {
        const ctx = setup();
        const { access_token: access } = await connect(ctx);
        ctx.clock.t += 3601_000;
        expect(await ctx.oauth.authenticate(bearer(access))).toBeNull();
    });

    it('refuses a made-up token or a refresh token used as an access token', async () => {
        const ctx = setup();
        const { refresh_token: refresh } = await connect(ctx);
        expect(await ctx.oauth.authenticate(bearer('jda_made-up'))).toBeNull();
        expect(await ctx.oauth.authenticate(bearer(refresh))).toBeNull();
        expect(await ctx.oauth.authenticate(new Request(`${BASE}/mcp`))).toBeNull();
    });

    it('refuses a token issued for another address (audience)', async () => {
        const ctx = setup();
        const { access_token: access } = await connect(ctx);
        // Same storage, another server address: the token's resource does not match it.
        const { t } = ctx;
        const shared = createOAuth({
            base: 'https://other.test',
            store: { getToken: async (hash) => t.tokens.get(hash) ?? null, getGrant: async (id) => t.grants.get(id) ?? null },
            isAllowedUser: async () => true,
        });
        expect(await shared.authenticate(bearer(access))).toBeNull();
    });

    it('rotates the refresh token, and reusing an old one ends the connection', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        const refresh = (token) => ctx.oauth.token({ grant_type: 'refresh_token', refresh_token: token, client_id: CIMD_URL });
        const second = await refresh(first.refresh_token);
        expect(second.status).toBe(200);
        expect(second.body.refresh_token).not.toBe(first.refresh_token);
        expect(await ctx.oauth.authenticate(bearer(second.body.access_token))).toMatchObject({ uid: 'joe' });

        const reused = await refresh(first.refresh_token);
        expect(reused).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
        expect(ctx.t.grants.size).toBe(0);
        expect(await ctx.oauth.authenticate(bearer(second.body.access_token))).toBeNull();
        expect((await refresh(second.body.refresh_token)).body.error).toBe('invalid_grant');
    });

    it('keeps a connection alive while it is used, and lets it lapse after 30 idle days', async () => {
        const ctx = setup();
        let tokens = await connect(ctx);
        const refresh = () => ctx.oauth.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CIMD_URL });
        for (let i = 0; i < 3; i++) {
            ctx.clock.t += 20 * 864e5;
            const next = await refresh();
            expect(next.status).toBe(200);
            tokens = next.body;
        }
        ctx.clock.t += 31 * 864e5;
        expect((await refresh()).body.error).toBe('invalid_grant');
    });

    it('cannot widen permissions on refresh', async () => {
        const ctx = setup();
        const { refresh_token: token } = await connect(ctx);
        const result = await ctx.oauth.token({ grant_type: 'refresh_token', refresh_token: token, client_id: CIMD_URL, scope: 'diary.read diary.suggest' });
        expect(result.body.error).toBe('invalid_scope');
    });

    it('ends every connection of a user removed from the allowlist', async () => {
        const ctx = setup();
        const { access_token: access, refresh_token: token } = await connect(ctx);
        ctx.allowedUsers.delete('joe');
        expect(await ctx.oauth.authenticate(bearer(access))).toBeNull();
        expect((await ctx.oauth.token({ grant_type: 'refresh_token', refresh_token: token, client_id: CIMD_URL })).body.error).toBe('invalid_grant');
    });

    it('ends the connection on revoke, and on a deleted grant', async () => {
        const ctx = setup();
        const one = await connect(ctx);
        expect((await ctx.oauth.revoke({ token: one.refresh_token })).status).toBe(200);
        expect(await ctx.oauth.authenticate(bearer(one.access_token))).toBeNull();
        expect((await ctx.oauth.revoke({ token: 'unknown' })).status).toBe(200);

        const two = await connect(ctx);
        const [grantId] = ctx.t.grants.keys();
        ctx.t.grants.delete(grantId);
        expect(await ctx.oauth.authenticate(bearer(two.access_token))).toBeNull();
    });

    it('logs steps and outcomes, never codes or tokens', async () => {
        const ctx = setup();
        const tokens = await connect(ctx);
        const logged = JSON.stringify(ctx.logs);
        expect(ctx.logs.length).toBeGreaterThan(0);
        expect(logged).not.toContain(tokens.access_token);
        expect(logged).not.toContain(tokens.refresh_token);
        expect(logged).not.toContain('joe');
    });
});

describe('connected apps in Settings', () => {
    it('lists only the signed-in user\'s live connections, newest use first, without tokens', async () => {
        const ctx = setup({ allowed: ['joe', 'karin'] });
        await exchange(ctx.oauth, (await getCode(ctx.oauth)).code);
        ctx.clock.t += 60_000;
        await exchange(ctx.oauth, (await getCode(ctx.oauth, { suggest: true })).code);
        await getCode(ctx.oauth, { idToken: 'id-karin' });

        const { status, body } = await ctx.oauth.listConnections({ idToken: 'id-joe' });
        expect(status).toBe(200);
        expect(body.connections).toHaveLength(2);
        expect(body.connections[0]).toMatchObject({ clientName: 'Claude Code', redirectHost: 'localhost', scopes: ['diary.read', 'diary.suggest'] });
        expect(Object.keys(body.connections[0]).sort()).toEqual(['clientName', 'createdAt', 'id', 'lastUsedAt', 'redirectHost', 'scopes']);

        ctx.clock.t += 31 * 864e5;
        expect((await ctx.oauth.listConnections({ idToken: 'id-joe' })).body.connections).toEqual([]);
    });

    it('refuses a stranger or a missing sign-in', async () => {
        const { oauth } = setup();
        expect((await oauth.listConnections({ idToken: 'id-stranger' })).status).toBe(401);
        expect((await oauth.listConnections({})).status).toBe(401);
    });

    it('revokes a connection so Claude must connect again, and only the owner\'s', async () => {
        const ctx = setup({ allowed: ['joe', 'karin'] });
        const tokens = (await exchange(ctx.oauth, (await getCode(ctx.oauth)).code)).body;
        const [{ id }] = (await ctx.oauth.listConnections({ idToken: 'id-joe' })).body.connections;

        expect((await ctx.oauth.revokeConnection({ idToken: 'id-karin', id })).status).toBe(404);
        expect(await ctx.oauth.authenticate(bearer(tokens.access_token))).not.toBeNull();

        expect((await ctx.oauth.revokeConnection({ idToken: 'id-joe', id })).body).toEqual({ revoked: true });
        expect(await ctx.oauth.authenticate(bearer(tokens.access_token))).toBeNull();
        expect((await ctx.oauth.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CIMD_URL })).body.error).toBe('invalid_grant');
        expect((await ctx.oauth.listConnections({ idToken: 'id-joe' })).body.connections).toEqual([]);
    });

    it('is reachable over HTTP as JSON', async () => {
        const { oauth } = setup();
        const handler = createConnectorHandler({ oauth, mcp: async () => null });
        const response = await handler(new Request(`${BASE}/oauth/connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'id-joe' }) }));
        expect(await response.json()).toEqual({ connections: [] });
    });
});

describe('Firebase adapter and store', () => {
    it('builds the request on the diary\'s own address, whatever the Host header says', async () => {
        const request = toWebRequest({
            method: 'POST',
            originalUrl: '/oauth/token?x=1',
            headers: { host: 'evil.example', 'content-type': 'application/x-www-form-urlencoded', 'content-length': '3', authorization: 'Bearer t' },
            rawBody: Buffer.from('a=b'),
        }, BASE);
        expect(request.url).toBe(`${BASE}/oauth/token?x=1`);
        expect(request.headers.get('authorization')).toBe('Bearer t');
        expect(await request.text()).toBe('a=b');
        expect(toWebRequest({ method: 'GET', url: '/mcp', headers: {} }, BASE).body).toBeNull();
    });

    it('sends the response uncached', async () => {
        const sent = { headers: {} };
        const res = { status: (s) => { sent.status = s; }, set: (k, v) => { sent.headers[k.toLowerCase()] = v; }, send: (b) => { sent.body = b.toString(); } };
        await sendWebResponse(res, new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json' } }));
        expect(sent).toEqual({ status: 201, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: '{"ok":true}' });
    });

    it('stores codes and tokens with a TTL, marks them used once, and deletes a grant with its tokens', async () => {
        const docs = new Map();
        const ref = (path) => ({
            path,
            get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
            set: async (value) => { docs.set(path, value); },
            update: async (fields) => {
                if (!docs.has(path)) throw new Error('NOT_FOUND');
                docs.set(path, { ...docs.get(path), ...fields });
            },
        });
        const db = {
            doc: ref,
            collection: (name) => ({
                where: (field, op, value) => ({
                    get: async () => ({ docs: [...docs].filter(([p, d]) => p.startsWith(`${name}/`) && d[field] === value).map(([p, d]) => ({ id: p.split('/')[1], ref: ref(p), data: () => d })) }),
                }),
            }),
            runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, f) => { docs.set(r.path, { ...docs.get(r.path), ...f }); } }),
            batch: () => {
                const deletes = [];
                return { delete: (r) => deletes.push(r.path), commit: async () => deletes.forEach(p => docs.delete(p)) };
            },
        };
        const store = createOAuthStore(db);
        await store.saveGrant('g1', { uid: 'joe' });
        await store.saveToken('h1', { grantId: 'g1', expiresAt: Date.parse('2026-11-13T10:00:00.000Z') });
        await store.saveCode('c1', { grantId: 'g1', expiresAt: Date.parse('2026-11-13T10:00:00.000Z') });
        expect(docs.get('mcpTokens/h1').deleteAfter).toEqual(new Date('2026-11-14T10:00:00.000Z'));
        expect((await store.useCode('c1')).firstUse).toBe(true);
        expect((await store.useCode('c1')).firstUse).toBe(false);
        expect(await store.useCode('missing')).toBeNull();
        expect(await store.listGrants('joe')).toEqual([{ id: 'g1', uid: 'joe' }]);
        await store.deleteGrant('g1');
        expect([...docs.keys()]).toEqual([]);
        await expect(store.updateGrant('g1', { lastUsedAt: 1 })).rejects.toThrow();
    });
});
