// @vitest-environment node
import { describe, expect, it } from 'vitest';
import worker from './index.js';

const env = {
    ALLOWED_ORIGINS: 'https://app.example',
    FIREBASE_PROJECT_ID: 'demo-project',
    ICS_URL: 'https://calendar.example/secret.ics',
};

const request = (headers = {}, method = 'GET') => new Request('https://proxy.example/calendar.ics', { method, headers });

describe('ics proxy', () => {
    it('refuses a request with a forged Origin but no sign-in, which is the old hole', async () => {
        const response = await worker.fetch(request({ Origin: 'https://app.example' }), env);
        expect(response.status).toBe(401);
        expect(await response.text()).toBe('Sign-in required');
    });

    it('refuses a garbage token', async () => {
        const response = await worker.fetch(request({ Origin: 'https://app.example', Authorization: 'Bearer a.b.c' }), env);
        expect(response.status).toBe(401);
    });

    it('still refuses unknown origins first', async () => {
        const response = await worker.fetch(request({ Origin: 'https://evil.example' }), env);
        expect(response.status).toBe(403);
    });

    it('answers the CORS preflight and allows the Authorization header', async () => {
        const response = await worker.fetch(request({ Origin: 'https://app.example' }, 'OPTIONS'), env);
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });
});
