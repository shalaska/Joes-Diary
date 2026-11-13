// The diary's own small OAuth sign-in server (Phase 3, part 2), so that Claude can use the MCP
// server without a password or a permanent key.
//
// Follows the MCP authorization spec (2026-07-28) and Claude's connector requirements:
// - Protected resource metadata (RFC 9728) and authorization server metadata (RFC 8414).
// - Public clients only, PKCE S256 required, tokens bound to this server's /mcp (RFC 8707).
// - Clients identify with a Client ID Metadata Document hosted by Claude, or register (DCR).
// - Only Claude's redirect addresses may receive a code (decision 3: only Claude may connect).
// - Access tokens last an hour. Refresh tokens last 30 days, are replaced on every use, and
//   reusing an old one ends the whole connection.
// - Identity is the app's own sign-in (Firebase), checked against the allowlist at consent and
//   on every call. Tokens are random strings stored only as SHA-256 hashes.
//
// Storage and identity are injected, so all of this runs in tests without Firebase.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SCOPES } from './mcp.js';

export const ACCESS_TOKEN_SECONDS = 3600;
export const REFRESH_TOKEN_DAYS = 30;
export const CODE_SECONDS = 300;

// Claude's OAuth callback, now and the address Anthropic says it may move to.
export const CLAUDE_REDIRECT_URIS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
// Hosts whose Client ID Metadata Documents are trusted (Claude's).
export const CLAUDE_METADATA_HOSTS = ['claude.ai', 'claude.com'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const ALL_SCOPES = [SCOPES.READ, SCOPES.SUGGEST];
const MAX_BODY = 16 * 1024;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const newSecret = (prefix) => `${prefix}_${randomBytes(32).toString('base64url')}`;

const parseUrl = (value) => {
    try { return new URL(value); } catch { return null; }
};

// Claude Code listens on a loopback port it picks at sign-in, so a loopback redirect matches on
// any port (RFC 8252 section 7.3). Everything else must match exactly.
const isLoopback = (url) => url?.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname) && url.pathname === '/callback';

export const isClaudeRedirect = (uri) => CLAUDE_REDIRECT_URIS.includes(uri) || isLoopback(parseUrl(uri));

const sameRedirect = (registered, requested) => {
    if (registered === requested) return true;
    const a = parseUrl(registered);
    const b = parseUrl(requested);
    return isLoopback(a) && isLoopback(b) && a.hostname === b.hostname && !b.search && !b.hash;
};

const redirectHost = (uri) => parseUrl(uri)?.hostname || '';

const withParams = (uri, params) => {
    const url = new URL(uri);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    return url.toString();
};

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});

const oauthError = (status, error, description) => ({ status, body: { error, error_description: description } });

// Reads a form or JSON body, whichever the client sent. Claude sends forms to the token endpoint.
const readBody = async (request) => {
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    if ((request.headers.get('content-type') || '').includes('application/json')) {
        try {
            const value = JSON.parse(text || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        } catch {
            return null;
        }
    }
    return Object.fromEntries(new URLSearchParams(text));
};

const str = (value) => (typeof value === 'string' ? value : '');

/**
 * base: the diary's address, e.g. https://joesdiary-d8211.web.app. It is the issuer, and the
 *   MCP server at base + /mcp is the one resource tokens are for.
 * store: the oauth storage (see createOAuthStore in store.js, or the in-memory one in tests).
 * verifyIdToken(idToken) -> uid, throws when the app sign-in is not valid.
 * isAllowedUser(uid) -> boolean, the diary's allowlist.
 * fetchClientMetadata(url) -> the JSON at a Client ID Metadata Document URL.
 */
export const createOAuth = ({ base, store, verifyIdToken, isAllowedUser, fetchClientMetadata, now = () => Date.now(), log = () => {} }) => {
    const resource = `${base}/mcp`;

    const protectedResourceMetadata = () => ({
        resource,
        authorization_servers: [base],
        scopes_supported: ALL_SCOPES,
        bearer_methods_supported: ['header'],
        resource_name: 'Joe\'s Diary',
    });

    const authorizationServerMetadata = () => ({
        issuer: base,
        authorization_endpoint: `${base}/connect`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ALL_SCOPES,
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
    });

    // -> { id, name, redirectUris } or null. A URL client_id is a metadata document, accepted
    // only from Claude's hosts. Anything else must have registered here.
    const resolveClient = async (clientId) => {
        if (!clientId) return null;
        if (clientId.startsWith('https://')) {
            const url = parseUrl(clientId);
            if (!url || !CLAUDE_METADATA_HOSTS.includes(url.hostname)) return null;
            let doc;
            try {
                doc = await fetchClientMetadata(clientId);
            } catch {
                return null;
            }
            if (doc?.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
            return { id: clientId, name: str(doc.client_name) || url.hostname, redirectUris: doc.redirect_uris.filter(u => typeof u === 'string') };
        }
        const doc = await store.getClient(clientId);
        return doc ? { id: clientId, name: doc.clientName || 'Unnamed app', redirectUris: doc.redirectUris || [] } : null;
    };

    // RFC 7591 dynamic registration, for Claude surfaces that do not use metadata documents yet.
    // Every redirect must be one of Claude's, so registering gains nothing for anyone else.
    const register = async (body) => {
        const redirectUris = body?.redirect_uris;
        if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 5 || !redirectUris.every(u => typeof u === 'string')) {
            return oauthError(400, 'invalid_redirect_uri', 'redirect_uris must list one to five addresses.');
        }
        if (!redirectUris.every(isClaudeRedirect)) {
            log({ feature: 'oauth', step: 'register', outcome: 'redirect_refused' });
            return oauthError(400, 'invalid_redirect_uri', 'Only Claude may connect to this diary.');
        }
        const clientId = randomUUID();
        const clientName = str(body.client_name).slice(0, 100) || 'Unnamed app';
        const issuedAt = Math.floor(now() / 1000);
        await store.saveClient(clientId, { clientName, redirectUris, createdAt: now() });
        log({ feature: 'oauth', step: 'register', outcome: 'ok' });
        return {
            status: 201,
            body: {
                client_id: clientId,
                client_id_issued_at: issuedAt,
                client_name: clientName,
                redirect_uris: redirectUris,
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            },
        };
    };

    // Checks an authorization request from the /connect page. A bad client or redirect is shown
    // on the page, never redirected to (the redirect cannot be trusted). Other problems go back
    // to the client as an OAuth error on its redirect.
    const checkAuthorization = async (params = {}) => {
        const client = await resolveClient(str(params.client_id));
        if (!client) return { ok: false, error: 'This app is not allowed to connect to your diary.' };
        const redirectUri = str(params.redirect_uri);
        if (!isClaudeRedirect(redirectUri) || !client.redirectUris.some(r => sameRedirect(r, redirectUri))) {
            return { ok: false, error: 'This app asked to send you to an address the diary does not allow.' };
        }
        const fail = (error, description) => ({
            ok: false,
            error: description,
            redirect: withParams(redirectUri, { error, error_description: description, state: str(params.state), iss: base }),
        });
        if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
        if (params.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(str(params.code_challenge))) {
            return fail('invalid_request', 'PKCE with S256 is required.');
        }
        if (params.resource && params.resource !== resource) return fail('invalid_target', `Tokens here are only for ${resource}.`);
        return {
            ok: true,
            client: { id: client.id, name: client.name },
            redirectUri,
            redirectHost: redirectHost(redirectUri),
            // Read is always part of a connection. Suggestions are offered as a separate tickbox,
            // whatever the client asked for, and are off unless the user ticks it.
            scopes: [SCOPES.READ],
            optionalScopes: [SCOPES.SUGGEST],
        };
    };

    // The user's answer on the consent page. idToken is their app sign-in.
    const authorize = async ({ params = {}, idToken, approved, suggest } = {}) => {
        const check = await checkAuthorization(params);
        if (!check.ok) return check.redirect ? { status: 200, body: { redirect: check.redirect } } : oauthError(400, 'invalid_request', check.error);

        let uid;
        try {
            uid = await verifyIdToken(str(idToken));
        } catch {
            return oauthError(401, 'login_required', 'Sign in to the diary first.');
        }
        if (!uid || !(await isAllowedUser(uid))) {
            log({ feature: 'oauth', step: 'authorize', outcome: 'not_allowed' });
            return oauthError(403, 'access_denied', 'This account is not allowed to use the diary.');
        }
        const state = str(params.state);
        if (approved !== true) {
            log({ feature: 'oauth', step: 'authorize', outcome: 'denied' });
            return { status: 200, body: { redirect: withParams(check.redirectUri, { error: 'access_denied', state, iss: base }) } };
        }

        const scopes = suggest === true ? [SCOPES.READ, SCOPES.SUGGEST] : [SCOPES.READ];
        const grantId = randomUUID();
        await store.saveGrant(grantId, {
            uid,
            clientId: check.client.id,
            clientName: check.client.name,
            redirectHost: check.redirectHost,
            scopes,
            createdAt: now(),
            lastUsedAt: now(),
            expiresAt: now() + REFRESH_TOKEN_DAYS * 864e5,
        });
        const code = newSecret('jdc');
        await store.saveCode(sha256(code), {
            grantId,
            uid,
            clientId: check.client.id,
            redirectUri: check.redirectUri,
            codeChallenge: params.code_challenge,
            scopes,
            resource,
            expiresAt: now() + CODE_SECONDS * 1000,
        });
        log({ feature: 'oauth', step: 'authorize', outcome: 'ok', scopes: scopes.length });
        return { status: 200, body: { redirect: withParams(check.redirectUri, { code, state, iss: base }) } };
    };

    // A grant is usable while it exists, has not expired, and its user is still allowed.
    const liveGrant = async (grantId, uid) => {
        const grant = await store.getGrant(grantId);
        if (!grant || grant.uid !== uid || grant.expiresAt <= now()) return null;
        if (!(await isAllowedUser(uid))) return null;
        return grant;
    };

    const issueTokens = async ({ grantId, uid, clientId, scopes }) => {
        const access = newSecret('jda');
        const refresh = newSecret('jdr');
        const shared = { grantId, uid, clientId, scopes, resource };
        await store.saveToken(sha256(access), { ...shared, kind: 'access', expiresAt: now() + ACCESS_TOKEN_SECONDS * 1000 });
        await store.saveToken(sha256(refresh), { ...shared, kind: 'refresh', expiresAt: now() + REFRESH_TOKEN_DAYS * 864e5 });
        await store.updateGrant(grantId, { lastUsedAt: now(), expiresAt: now() + REFRESH_TOKEN_DAYS * 864e5 });
        return {
            status: 200,
            body: {
                access_token: access,
                token_type: 'Bearer',
                expires_in: ACCESS_TOKEN_SECONDS,
                refresh_token: refresh,
                scope: scopes.join(' '),
            },
        };
    };

    const exchangeCode = async (form) => {
        const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier } = form;
        if (!code || !redirectUri || !clientId || !verifier) return oauthError(400, 'invalid_request', 'code, redirect_uri, client_id and code_verifier are required.');
        const used = await store.useCode(sha256(str(code)));
        if (!used) return oauthError(400, 'invalid_grant', 'Unknown code.');
        const doc = used.doc;
        if (!used.firstUse) {
            // A code used twice may have been stolen: end the connection it started.
            await store.deleteGrant(doc.grantId);
            log({ feature: 'oauth', step: 'token', outcome: 'code_reused' });
            return oauthError(400, 'invalid_grant', 'This code was already used.');
        }
        if (doc.expiresAt <= now()) return oauthError(400, 'invalid_grant', 'The code has expired.');
        if (doc.clientId !== clientId || doc.redirectUri !== redirectUri) return oauthError(400, 'invalid_grant', 'The code was issued to another client or redirect.');
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(str(verifier)) || pkceChallenge(verifier) !== doc.codeChallenge) {
            return oauthError(400, 'invalid_grant', 'PKCE verification failed.');
        }
        if (form.resource && form.resource !== doc.resource) return oauthError(400, 'invalid_target', `Tokens here are only for ${resource}.`);
        if (!(await liveGrant(doc.grantId, doc.uid))) return oauthError(400, 'invalid_grant', 'This connection is no longer allowed.');
        log({ feature: 'oauth', step: 'token', grant: 'authorization_code', outcome: 'ok' });
        return issueTokens(doc);
    };

    const refresh = async (form) => {
        if (!form.refresh_token || !form.client_id) return oauthError(400, 'invalid_request', 'refresh_token and client_id are required.');
        const used = await store.useToken(sha256(str(form.refresh_token)));
        if (!used || used.doc.kind !== 'refresh') return oauthError(400, 'invalid_grant', 'Unknown refresh token.');
        const doc = used.doc;
        if (!used.firstUse) {
            // Refresh tokens are single-use. Reuse means two parties hold it: end the connection.
            await store.deleteGrant(doc.grantId);
            log({ feature: 'oauth', step: 'token', outcome: 'refresh_reused' });
            return oauthError(400, 'invalid_grant', 'This refresh token was already used. Connect again.');
        }
        if (doc.expiresAt <= now()) return oauthError(400, 'invalid_grant', 'The refresh token has expired.');
        if (doc.clientId !== form.client_id) return oauthError(400, 'invalid_grant', 'The refresh token belongs to another client.');
        if (form.resource && form.resource !== doc.resource) return oauthError(400, 'invalid_target', `Tokens here are only for ${resource}.`);
        let scopes = doc.scopes;
        if (form.scope) {
            const asked = str(form.scope).split(' ').filter(Boolean);
            if (!asked.every(s => doc.scopes.includes(s))) return oauthError(400, 'invalid_scope', 'A refresh cannot add permissions.');
            scopes = asked;
        }
        if (!(await liveGrant(doc.grantId, doc.uid))) return oauthError(400, 'invalid_grant', 'This connection is no longer allowed.');
        log({ feature: 'oauth', step: 'token', grant: 'refresh_token', outcome: 'ok' });
        return issueTokens({ ...doc, scopes });
    };

    const token = async (form) => {
        if (!form) return oauthError(400, 'invalid_request', 'Send a form-encoded body.');
        if (form.grant_type === 'authorization_code') return exchangeCode(form);
        if (form.grant_type === 'refresh_token') return refresh(form);
        return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
    };

    // RFC 7009. Revoking either token ends the whole connection. Always 200, so it tells a caller
    // nothing about which tokens exist.
    const revoke = async (form) => {
        const doc = form?.token ? await store.getToken(sha256(str(form.token))) : null;
        if (doc && (!form.client_id || doc.clientId === form.client_id)) {
            await store.deleteGrant(doc.grantId);
            log({ feature: 'oauth', step: 'revoke', outcome: 'ok' });
        }
        return { status: 200, body: {} };
    };

    // For the MCP handler: the request's bearer token -> { uid, scopes } or null.
    const authenticate = async (request) => {
        const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
        if (!match) return null;
        const doc = await store.getToken(sha256(match[1]));
        if (!doc || doc.kind !== 'access' || doc.expiresAt <= now() || doc.resource !== resource) return null;
        if (!(await liveGrant(doc.grantId, doc.uid))) return null;
        return { uid: doc.uid, scopes: doc.scopes, grantId: doc.grantId };
    };

    // "Connected apps" in the diary's Settings: the signed-in user's own connections, and revoke.
    const signedInUser = async (idToken) => {
        let uid;
        try {
            uid = await verifyIdToken(str(idToken));
        } catch {
            return null;
        }
        return uid && (await isAllowedUser(uid)) ? uid : null;
    };

    const listConnections = async ({ idToken } = {}) => {
        const uid = await signedInUser(idToken);
        if (!uid) return oauthError(401, 'login_required', 'Sign in to the diary first.');
        const grants = (await store.listGrants(uid)).filter(g => g.expiresAt > now());
        const connections = grants
            .map(g => ({ id: g.id, clientName: g.clientName, redirectHost: g.redirectHost, scopes: g.scopes, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt }))
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        return { status: 200, body: { connections } };
    };

    const revokeConnection = async ({ idToken, id } = {}) => {
        const uid = await signedInUser(idToken);
        if (!uid) return oauthError(401, 'login_required', 'Sign in to the diary first.');
        const grant = id ? await store.getGrant(str(id)) : null;
        // Someone else's connection looks the same as one that does not exist.
        if (!grant || grant.uid !== uid) return { status: 404, body: { error: 'not_found' } };
        await store.deleteGrant(str(id));
        log({ feature: 'oauth', step: 'revoke_in_settings', outcome: 'ok' });
        return { status: 200, body: { revoked: true } };
    };

    // The HTTP routes for everything above. Returns null for a path that is not OAuth's.
    const handle = async (request) => {
        const { pathname } = new URL(request.url);
        const method = request.method;
        if (method === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp')) {
            return json(200, protectedResourceMetadata());
        }
        if (method === 'GET' && pathname === '/.well-known/oauth-authorization-server') return json(200, authorizationServerMetadata());
        if (pathname.startsWith('/.well-known/')) return json(404, { error: 'not_found' });

        const routes = {
            '/oauth/register': async (body) => register(body),
            '/oauth/authorize/check': async (body) => {
                const check = await checkAuthorization(body?.params);
                return { status: check.ok ? 200 : 400, body: check };
            },
            '/oauth/authorize': async (body) => authorize(body || {}),
            '/oauth/token': token,
            '/oauth/revoke': revoke,
            '/oauth/connections': async (body) => listConnections(body || {}),
            '/oauth/connections/revoke': async (body) => revokeConnection(body || {}),
        };
        const route = routes[pathname];
        if (!route) return pathname.startsWith('/oauth/') ? json(404, { error: 'not_found' }) : null;
        if (method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        try {
            const result = await route(await readBody(request));
            return json(result.status, result.body);
        } catch {
            log({ feature: 'oauth', step: pathname, outcome: 'error' });
            return json(500, { error: 'server_error' });
        }
    };

    return { resource, protectedResourceMetadata, authorizationServerMetadata, register, checkAuthorization, authorize, token, revoke, authenticate, listConnections, revokeConnection, handle };
};

// Fetches a Client ID Metadata Document: https only, no redirects, 5 s, at most 16 KB.
export const fetchClientMetadata = async (url, fetchImpl = fetch) => {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Client metadata ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BODY) throw new Error('Client metadata too large');
    return JSON.parse(text);
};
