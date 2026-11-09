// Firebase ID token verification for the calendar proxy, with WebCrypto only (no SDK).
// A caller must send `Authorization: Bearer <Firebase ID token>` for an account on the
// allowlist. The Origin check stays as a second layer, but it is not authentication:
// any non-browser client can send whatever Origin header it likes.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_SECONDS = 300;
const ALLOWLIST_TTL_MS = 5 * 60 * 1000;

export class AuthError extends Error {
    constructor(message, status = 401) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}

const base64UrlToBytes = (value) => {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const decodeJson = (segment) => {
    try {
        return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
    } catch {
        throw new AuthError('Malformed token');
    }
};

export const bearerToken = (request) => {
    const header = request.headers.get('Authorization') || '';
    const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
    if (!match) throw new AuthError('Missing bearer token');
    return match[1];
};

// Google's signing keys rotate; honour the Cache-Control max-age it sends.
export const createKeyStore = ({ fetchImpl = fetch, now = () => Date.now() } = {}) => {
    let cached = { keys: null, expiresAt: 0 };
    return async () => {
        if (cached.keys && now() < cached.expiresAt) return cached.keys;
        const response = await fetchImpl(JWKS_URL);
        if (!response.ok) throw new AuthError('Signing keys unavailable', 503);
        const { keys } = await response.json();
        const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '')?.[1] || 3600);
        cached = { keys, expiresAt: now() + maxAge * 1000 };
        return keys;
    };
};

export const verifyFirebaseIdToken = async (token, { projectId, getKeys, nowSeconds = () => Math.floor(Date.now() / 1000) }) => {
    const parts = token.split('.');
    if (parts.length !== 3) throw new AuthError('Malformed token');
    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const header = decodeJson(headerSegment);
    const claims = decodeJson(payloadSegment);
    const now = nowSeconds();

    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('Unexpected token algorithm');
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Wrong issuer');
    if (claims.aud !== projectId) throw new AuthError('Wrong audience');
    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 128) throw new AuthError('Missing subject');
    if (typeof claims.exp !== 'number' || claims.exp <= now) throw new AuthError('Token expired');
    if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_SECONDS) throw new AuthError('Token issued in the future');
    if (typeof claims.auth_time !== 'number' || claims.auth_time > now + CLOCK_SKEW_SECONDS) throw new AuthError('Bad auth time');

    const jwk = (await getKeys()).find((key) => key.kid === header.kid);
    if (!jwk) throw new AuthError('Unknown signing key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        base64UrlToBytes(signatureSegment),
        new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
    if (!valid) throw new AuthError('Bad signature');
    return claims;
};

// The allowlist lives in Firestore (allowedUsers/{uid}). The rules let a signed-in user read
// only their own entry, so the proxy checks it with the caller's own token and needs no
// credentials of its own. Positive answers are cached briefly per uid.
export const createAllowlistCheck = ({ projectId, fetchImpl = fetch, now = () => Date.now() }) => {
    const allowedUntil = new Map();
    return async (uid, idToken) => {
        if ((allowedUntil.get(uid) || 0) > now()) return true;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/allowedUsers/${encodeURIComponent(uid)}`;
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (response.ok) {
            allowedUntil.set(uid, now() + ALLOWLIST_TTL_MS);
            return true;
        }
        if (response.status === 403 || response.status === 404) return false;
        throw new AuthError('Allowlist check unavailable', 503);
    };
};
