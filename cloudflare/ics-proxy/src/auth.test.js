// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthError, bearerToken, createAllowlistCheck, createKeyStore, verifyFirebaseIdToken } from './auth.js';

const PROJECT = 'demo-project';
const NOW = 1_800_000_000;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeJson = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let keyPair;
let otherKeyPair;
let publicJwk;

beforeAll(async () => {
    const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    keyPair = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
    otherKeyPair = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
    publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
});

const sign = async (claims = {}, { header = {}, privateKey = keyPair.privateKey } = {}) => {
    const head = encodeJson({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header });
    const body = encodeJson({
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        sub: 'joe-uid',
        iat: NOW - 60,
        auth_time: NOW - 600,
        exp: NOW + 3000,
        ...claims,
    });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(signature)}`;
};

const verify = (token) => verifyFirebaseIdToken(token, { projectId: PROJECT, getKeys: async () => [publicJwk], nowSeconds: () => NOW });

describe('verifyFirebaseIdToken', () => {
    it('accepts a valid token and returns its claims', async () => {
        await expect(verify(await sign())).resolves.toMatchObject({ sub: 'joe-uid' });
    });

    it.each([
        ['an expired token', { exp: NOW - 1 }],
        ['another project', { aud: 'someone-else' }],
        ['the wrong issuer', { iss: 'https://securetoken.google.com/someone-else' }],
        ['no subject', { sub: '' }],
        ['a future issue time', { iat: NOW + 3600 }],
    ])('rejects %s', async (_, claims) => {
        await expect(verify(await sign(claims))).rejects.toBeInstanceOf(AuthError);
    });

    it('rejects a token signed by a key Google did not publish', async () => {
        await expect(verify(await sign({}, { privateKey: otherKeyPair.privateKey }))).rejects.toThrow('Bad signature');
        await expect(verify(await sign({}, { header: { kid: 'unknown' } }))).rejects.toThrow('Unknown signing key');
    });

    it('rejects an unsigned or tampered token', async () => {
        const token = await sign();
        const [head, , signature] = token.split('.');
        const forged = encodeJson({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'attacker', iat: NOW, auth_time: NOW, exp: NOW + 100 });
        await expect(verify(`${head}.${forged}.${signature}`)).rejects.toThrow('Bad signature');
        await expect(verify(await sign({}, { header: { alg: 'none' } }))).rejects.toThrow('Unexpected token algorithm');
    });
});

describe('bearerToken', () => {
    it('reads a bearer token and rejects anything else', () => {
        expect(bearerToken(new Request('https://x', { headers: { Authorization: 'Bearer a.b.c' } }))).toBe('a.b.c');
        expect(() => bearerToken(new Request('https://x'))).toThrow(AuthError);
        expect(() => bearerToken(new Request('https://x', { headers: { Authorization: 'Basic abc' } }))).toThrow(AuthError);
    });
});

describe('createKeyStore', () => {
    it('caches Google keys for the max-age it is given', async () => {
        let clock = 0;
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'Cache-Control': 'public, max-age=100' } }));
        const getKeys = createKeyStore({ fetchImpl, now: () => clock });
        await getKeys();
        clock = 99_000;
        await getKeys();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        clock = 101_000;
        await getKeys();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});

describe('createAllowlistCheck', () => {
    it('asks Firestore with the caller\'s own token and caches a yes', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
        const check = createAllowlistCheck({ projectId: PROJECT, fetchImpl, now: () => 0 });
        await expect(check('joe-uid', 'tok')).resolves.toBe(true);
        await expect(check('joe-uid', 'tok')).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toContain('/allowedUsers/joe-uid');
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('says no for a missing or forbidden entry, and never caches a no', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));
        const check = createAllowlistCheck({ projectId: PROJECT, fetchImpl, now: () => 0 });
        await expect(check('stranger', 'tok')).resolves.toBe(false);
        await expect(check('stranger', 'tok')).resolves.toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('fails closed with a 503 when Firestore is unavailable', async () => {
        const check = createAllowlistCheck({ projectId: PROJECT, fetchImpl: async () => new Response('', { status: 500 }), now: () => 0 });
        await expect(check('joe-uid', 'tok')).rejects.toMatchObject({ status: 503 });
    });
});
