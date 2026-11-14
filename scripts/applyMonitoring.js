// Makes Google Cloud Monitoring match ops/monitoring/config.js: log-based metrics, the
// service, its SLOs, an email channel and one burn-rate alert per SLO. Safe to run again:
// it creates what is missing and updates what exists, matched by name.
//
// CI: the Monitoring workflow runs it with GCP_TOKEN (a short-lived token for the
// github-deploy service account) and ALERT_EMAIL (a repository secret).
// Locally: node scripts/applyMonitoring.js --dry-run prints what it would send.
import { alertPolicy, LOG_METRICS, PROJECT, SERVICE, SERVICE_ID, SLOS } from '../ops/monitoring/config.js';

const LOGGING = 'https://logging.googleapis.com/v2';
const MONITORING = 'https://monitoring.googleapis.com/v3';

// api(method, url, body) -> { status, body }. Never throws on 404, so callers can upsert.
export const createApi = ({ token, fetchImpl = fetch }) => async (method, url, body) => {
    const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok && response.status !== 404) {
        throw new Error(`${method} ${url.split('?')[0]} -> HTTP ${response.status}: ${parsed.error?.message ?? text.slice(0, 300)}`);
    }
    return { status: response.status, body: parsed };
};

const upsert = async (api, { getUrl, createUrl, updateUrl, updateMethod = 'PUT', body, label, log }) => {
    const existing = await api('GET', getUrl);
    if (existing.status === 404) {
        const created = await api('POST', createUrl, body);
        log(`created ${label}`);
        return created.body;
    }
    const updated = await api(updateMethod, updateUrl, body);
    log(`updated ${label}`);
    return updated.body;
};

export const applyMonitoring = async ({ api, alertEmail, log = console.log }) => {
    const project = `projects/${PROJECT}`;

    for (const metric of LOG_METRICS) {
        await upsert(api, {
            label: `log metric ${metric.name}`, log, body: metric,
            getUrl: `${LOGGING}/${project}/metrics/${metric.name}`,
            createUrl: `${LOGGING}/${project}/metrics`,
            updateUrl: `${LOGGING}/${project}/metrics/${metric.name}`,
        });
    }

    const servicePath = `${MONITORING}/${project}/services/${SERVICE_ID}`;
    if ((await api('GET', servicePath)).status === 404) {
        await api('POST', `${MONITORING}/${project}/services?serviceId=${SERVICE_ID}`, SERVICE);
        log(`created service ${SERVICE_ID}`);
    }

    // The email channel, found by its address so a rerun does not add a second one. The
    // address itself is never printed: it only travels to the Monitoring API.
    let channelName = null;
    if (alertEmail) {
        const { body } = await api('GET', `${MONITORING}/${project}/notificationChannels?filter=${encodeURIComponent('type="email"')}`);
        const match = (body.notificationChannels || []).find(c => c.labels?.email_address === alertEmail);
        channelName = match?.name ?? (await api('POST', `${MONITORING}/${project}/notificationChannels`, {
            type: 'email', displayName: 'Joe\'s Diary alerts', labels: { email_address: alertEmail },
        })).body.name;
        log(match ? 'email channel already set up' : 'created email channel');
    } else {
        log('no ALERT_EMAIL: alerts are created without anyone to notify');
    }

    for (const slo of SLOS) {
        const { id, why, ...definition } = slo;
        const saved = await upsert(api, {
            label: `SLO ${id}`, log, body: definition, updateMethod: 'PATCH',
            getUrl: `${servicePath}/serviceLevelObjectives/${id}`,
            createUrl: `${servicePath}/serviceLevelObjectives?serviceLevelObjectiveId=${id}`,
            updateUrl: `${servicePath}/serviceLevelObjectives/${id}`,
        });
        const sloName = saved.name || `${project}/services/${SERVICE_ID}/serviceLevelObjectives/${id}`;

        const policy = alertPolicy({ ...slo, why }, sloName, channelName);
        const { body } = await api('GET', `${MONITORING}/${project}/alertPolicies?filter=${encodeURIComponent(`display_name="${policy.displayName}"`)}`);
        const existing = body.alertPolicies?.[0];
        if (existing) {
            await api('PATCH', `${MONITORING}/${existing.name}`, policy);
            log(`updated alert for ${id}`);
        } else {
            await api('POST', `${MONITORING}/${project}/alertPolicies`, policy);
            log(`created alert for ${id}`);
        }
    }
};

// Dry run: answers every GET with 404 and prints each write instead of sending it.
export const dryRunApi = (print) => async (method, url, body) => {
    if (method === 'GET') return { status: 404, body: {} };
    print(`${method} ${url}\n${JSON.stringify(body, null, 2)}\n`);
    return { status: 200, body: { name: 'dry-run' } };
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const dryRun = process.argv.includes('--dry-run');
    const token = process.env.GCP_TOKEN;
    if (!dryRun && !token) {
        console.error('GCP_TOKEN is not set. Use --dry-run to print the plan.');
        process.exit(1);
    }
    await applyMonitoring({
        api: dryRun ? dryRunApi(console.log) : createApi({ token }),
        alertEmail: dryRun ? null : process.env.ALERT_EMAIL,
    });
}
