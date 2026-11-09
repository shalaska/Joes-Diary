import { AuthError, bearerToken, createAllowlistCheck, createKeyStore, verifyFirebaseIdToken } from './auth.js';

const corsHeaders = (origin) => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
});

// Module scope survives between requests on a warm isolate, so keys and allowlist answers are reused.
const getKeys = createKeyStore();
let allowlistCheck = null;

const authorize = async (request, env) => {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new AuthError('Proxy is not configured', 503);
    allowlistCheck ??= createAllowlistCheck({ projectId });
    const token = bearerToken(request);
    const claims = await verifyFirebaseIdToken(token, { projectId, getKeys });
    if (!(await allowlistCheck(claims.sub, token))) throw new AuthError('Account is not allowed', 403);
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const allowedOrigins = new Set(
            (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
        );

        if (!origin || !allowedOrigins.has(origin)) {
            return new Response('Origin not allowed', { status: 403 });
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== 'GET' || url.pathname !== '/calendar.ics') {
            return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
        }

        try {
            await authorize(request, env);
        } catch (error) {
            const status = error instanceof AuthError ? error.status : 401;
            const message = { 403: 'Account is not allowed', 503: 'Sign-in check unavailable' }[status] || 'Sign-in required';
            return new Response(message, {
                status,
                headers: corsHeaders(origin),
            });
        }

        if (!env.ICS_URL) {
            return new Response('ICS feed is not configured', { status: 503, headers: corsHeaders(origin) });
        }

        try {
            const upstream = await fetch(env.ICS_URL, {
                headers: { 'User-Agent': 'JoesDiary-Calendar/1.0' },
                cf: { cacheEverything: true, cacheTtl: 300 },
            });
            if (!upstream.ok) {
                return new Response('Calendar feed is unavailable', {
                    status: 502,
                    headers: corsHeaders(origin),
                });
            }

            const headers = new Headers(corsHeaders(origin));
            headers.set('Content-Type', 'text/calendar; charset=utf-8');
            headers.set('Cache-Control', 'private, max-age=300');
            headers.set('X-Content-Type-Options', 'nosniff');
            return new Response(upstream.body, { status: 200, headers });
        } catch (error) {
            console.error('ICS proxy fetch failed', error);
            return new Response('Calendar feed is unavailable', {
                status: 502,
                headers: corsHeaders(origin),
            });
        }
    },
};
