import { describe, expect, it } from 'vitest';
import { applyMonitoring, createApi, dryRunApi } from './applyMonitoring.js';
import { BAD_OUTCOMES, LATENCY_BOUNDS_MS, LOG_METRICS, QUICK_FEATURES, SLOS } from '../ops/monitoring/config.js';
import { FEATURES } from '../gateway/src/features.js';
import { SERVER_FAILURES } from '../gateway/src/tracing.js';

// A fake Cloud Monitoring and Logging: stores what is written, answers GETs from it.
const fakeCloud = () => {
    const store = new Map();
    const calls = [];
    const key = (url) => url.split('?')[0];
    const api = async (method, url, body) => {
        calls.push({ method, url, body });
        if (method === 'GET') {
            if (url.includes('/notificationChannels?')) return { status: 200, body: { notificationChannels: [...store.values()].filter(v => v.type === 'email') } };
            if (url.includes('/alertPolicies?')) {
                const name = decodeURIComponent(url).split('display_name="')[1].replace(/"$/, '');
                return { status: 200, body: { alertPolicies: [...store.values()].filter(v => v.displayName === name) } };
            }
            return store.has(key(url)) ? { status: 200, body: store.get(key(url)) } : { status: 404, body: {} };
        }
        if (method === 'POST') {
            const idParam = /[?&](?:serviceId|serviceLevelObjectiveId)=([^&]+)/.exec(url)?.[1];
            const id = idParam ?? body.name ?? `auto-${calls.length}`;
            const name = `${key(url).replace('https://monitoring.googleapis.com/v3/', '').replace('https://logging.googleapis.com/v2/', '')}/${id}`;
            const saved = { ...body, name };
            const base = url.startsWith('https://logging') ? 'https://logging.googleapis.com/v2/' : 'https://monitoring.googleapis.com/v3/';
            store.set(`${base}${name}`, saved);
            return { status: 200, body: saved };
        }
        store.set(key(url), { ...store.get(key(url)), ...body });
        return { status: 200, body: store.get(key(url)) };
    };
    return { api, calls, store };
};

describe('monitoring config', () => {
    it('covers every quick feature and leaves Ask to its own SLO', () => {
        expect(QUICK_FEATURES.sort()).toEqual(Object.keys(FEATURES).sort());
        expect(QUICK_FEATURES).not.toContain('ask');
    });

    it('spends the availability budget only on the failures the traces mark as errors', () => {
        expect(new Set(BAD_OUTCOMES)).toEqual(SERVER_FAILURES);
    });

    it('puts every latency threshold on a bucket edge, so the SLIs count exactly', () => {
        for (const slo of SLOS) {
            const cut = slo.serviceLevelIndicator.requestBased.distributionCut;
            if (cut) expect(LATENCY_BOUNDS_MS).toContain(cut.range.max);
        }
    });

    it('builds every SLI on a log metric defined here', () => {
        const names = LOG_METRICS.map(m => `logging.googleapis.com/user/${m.name}`);
        for (const slo of SLOS) {
            const filters = JSON.stringify(slo.serviceLevelIndicator).match(/logging\.googleapis\.com\/user\/[a-z_]+/g);
            expect(filters.length).toBeGreaterThan(0);
            filters.forEach(f => expect(names).toContain(f));
        }
    });

    it('reads only metadata fields from the log lines', () => {
        const fields = JSON.stringify(LOG_METRICS).match(/jsonPayload\.[a-zA-Z]+/g);
        expect(new Set(fields)).toEqual(new Set(['jsonPayload.message', 'jsonPayload.latencyMs', 'jsonPayload.feature', 'jsonPayload.outcome', 'jsonPayload.tool']));
    });
});

describe('applyMonitoring', () => {
    it('creates everything on the first run, then only updates on the next', async () => {
        const cloud = fakeCloud();
        const lines = [];
        await applyMonitoring({ api: cloud.api, alertEmail: 'me@example.test', log: (l) => lines.push(l) });
        expect(lines.filter(l => l.startsWith('created'))).toHaveLength(LOG_METRICS.length + 1 + 1 + SLOS.length * 2);

        const posts = cloud.calls.filter(c => c.method === 'POST');
        const policies = posts.filter(c => c.url.endsWith('/alertPolicies'));
        expect(policies).toHaveLength(SLOS.length);
        expect(policies[0].body.conditions[0].conditionThreshold.filter).toMatch(/^select_slo_burn_rate\("projects\/joesdiary-d8211\/services\/joes-diary\/serviceLevelObjectives\/ask-latency", "21600s"\)$/);
        expect(policies[0].body.notificationChannels).toHaveLength(1);
        expect(posts.find(c => c.url.includes('serviceLevelObjectiveId=ask-latency')).body).not.toHaveProperty('why');

        cloud.calls.length = 0;
        const again = [];
        await applyMonitoring({ api: cloud.api, alertEmail: 'me@example.test', log: (l) => again.push(l) });
        expect(cloud.calls.filter(c => c.method === 'POST')).toEqual([]);
        expect(again).toContain('email channel already set up');
    });

    it('never prints the alert email', async () => {
        const cloud = fakeCloud();
        const lines = [];
        await applyMonitoring({ api: cloud.api, alertEmail: 'me@example.test', log: (l) => lines.push(l) });
        expect(lines.join('\n')).not.toContain('me@example.test');
    });

    it('prints the plan in a dry run without calling Google', async () => {
        const out = [];
        await applyMonitoring({ api: dryRunApi((s) => out.push(s)), alertEmail: null, log: () => {} });
        expect(out.join('\n')).toContain('diary_llm_latency');
        expect(out.join('\n')).toContain('serviceLevelObjectiveId=ai-availability');
    });

    it('reports an API error with its status and message', async () => {
        const api = createApi({ token: 't', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 }) });
        await expect(api('POST', 'https://monitoring.googleapis.com/v3/projects/p/services?serviceId=x', {})).rejects.toThrow('HTTP 403: Permission denied');
    });
});
