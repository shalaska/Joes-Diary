// The diary's service level objectives (SLOs) and their alerts, as code.
// scripts/applyMonitoring.js makes Google Cloud Monitoring match this file; the
// "Monitoring" workflow runs it whenever this file changes on main.
//
// How the pieces fit:
// 1. SLIs come from the gateway's structured log lines (llm_call, mcp_call), which already
//    carry feature, outcome and latencyMs and never any diary text. Log-based metrics turn
//    those lines into numbers Cloud Monitoring can count.
// 2. Each SLO says what share of requests must be good over a rolling 28 days.
// 3. Each SLO gets a burn-rate alert: it emails when the error budget is being spent much
//    faster than the SLO allows, rather than on every single slow or failed request.
import { FEATURES } from '../../gateway/src/features.js';

export const PROJECT = 'joesdiary-d8211';
export const SERVICE_ID = 'joes-diary';
export const SERVICE = { displayName: 'Joe\'s Diary', custom: {} };

// Bucket edges in ms. Every SLO threshold below is one of these edges, so "under 8 s" is
// counted exactly, not estimated from a bucket that straddles 8 s.
export const LATENCY_BOUNDS_MS = [100, 250, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 45000, 60000, 90000, 120000];

// Outcomes the gateway logs. Only server failures spend the availability budget; the
// caller's mistakes (invalid input, signed out, daily limit) are not the diary's fault.
// gateway/src/tracing.js marks spans with the same split (SERVER_FAILURES).
export const GOOD_OUTCOMES = ['ok', 'ok_at_limit'];
export const BAD_OUTCOMES = ['error', 'model_error', 'model_unavailable', 'invalid_json', 'schema_fail', 'step_limit', 'empty_answer'];

// The single-shot AI features: everything in FEATURES. Ask (the agent) has its own SLO.
export const QUICK_FEATURES = Object.keys(FEATURES);

const user = (name) => `logging.googleapis.com/user/${name}`;
const label = (key) => ({ key, valueType: 'STRING' });
const oneOf = (values) => `one_of(${values.map(v => JSON.stringify(v)).join(', ')})`;
const RESOURCE = 'resource.type="cloud_run_revision"';

export const LOG_METRICS = [
    {
        name: 'diary_llm_latency',
        description: 'Joe\'s Diary: latency of each AI gateway call, from the llm_call log line (metadata only).',
        filter: `${RESOURCE} AND jsonPayload.message="llm_call" AND jsonPayload.latencyMs>=0`,
        metricDescriptor: { metricKind: 'DELTA', valueType: 'DISTRIBUTION', unit: 'ms', labels: [label('feature'), label('outcome')] },
        valueExtractor: 'EXTRACT(jsonPayload.latencyMs)',
        labelExtractors: { feature: 'EXTRACT(jsonPayload.feature)', outcome: 'EXTRACT(jsonPayload.outcome)' },
        bucketOptions: { explicitBuckets: { bounds: LATENCY_BOUNDS_MS } },
    },
    {
        name: 'diary_llm_requests',
        description: 'Joe\'s Diary: AI gateway calls by feature and outcome, from the llm_call log line (metadata only).',
        filter: `${RESOURCE} AND jsonPayload.message="llm_call"`,
        metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [label('feature'), label('outcome')] },
        labelExtractors: { feature: 'EXTRACT(jsonPayload.feature)', outcome: 'EXTRACT(jsonPayload.outcome)' },
    },
    {
        name: 'diary_mcp_tool_latency',
        description: 'Joe\'s Diary: latency of each tool call from Claude, from the mcp_call log line (metadata only).',
        filter: `${RESOURCE} AND jsonPayload.message="mcp_call" AND jsonPayload.latencyMs>=0`,
        metricDescriptor: { metricKind: 'DELTA', valueType: 'DISTRIBUTION', unit: 'ms', labels: [label('tool')] },
        valueExtractor: 'EXTRACT(jsonPayload.latencyMs)',
        labelExtractors: { tool: 'EXTRACT(jsonPayload.tool)' },
        bucketOptions: { explicitBuckets: { bounds: LATENCY_BOUNDS_MS } },
    },
];

const DAYS_28 = `${28 * 86400}s`;

// A latency SLI: the share of requests faster than maxMs.
const latencySli = (metric, extraFilter, maxMs) => ({
    requestBased: {
        distributionCut: {
            distributionFilter: `metric.type="${user(metric)}" ${RESOURCE}${extraFilter ? ` ${extraFilter}` : ''}`,
            range: { min: 0, max: maxMs },
        },
    },
});

export const SLOS = [
    {
        id: 'ask-latency',
        displayName: 'Ask answers within 20 s (95%)',
        goal: 0.95,
        rollingPeriod: DAYS_28,
        serviceLevelIndicator: latencySli('diary_llm_latency', 'metric.label.feature="ask"', 20000),
        why: 'Ask runs an agent: several model calls and tool calls. 20 s is long enough for that and short enough to keep waiting for.',
    },
    {
        id: 'quick-latency',
        displayName: 'Quick AI features within 8 s (95%)',
        goal: 0.95,
        rollingPeriod: DAYS_28,
        serviceLevelIndicator: latencySli('diary_llm_latency', `metric.label.feature=${oneOf(QUICK_FEATURES)}`, 8000),
        why: 'Tidy, chat, to-do extraction and the like are one model call each, so the user expects an answer in seconds.',
    },
    {
        id: 'connector-latency',
        displayName: 'Claude tool calls within 2 s (99%)',
        goal: 0.99,
        rollingPeriod: DAYS_28,
        serviceLevelIndicator: latencySli('diary_mcp_tool_latency', '', 2000),
        why: 'Tool calls only read or write Firestore, and Claude waits on each one mid-answer.',
    },
    {
        id: 'ai-availability',
        displayName: 'AI features succeed (99%)',
        goal: 0.99,
        rollingPeriod: DAYS_28,
        serviceLevelIndicator: {
            requestBased: {
                goodTotalRatio: {
                    goodServiceFilter: `metric.type="${user('diary_llm_requests')}" ${RESOURCE} metric.label.outcome=${oneOf(GOOD_OUTCOMES)}`,
                    badServiceFilter: `metric.type="${user('diary_llm_requests')}" ${RESOURCE} metric.label.outcome=${oneOf(BAD_OUTCOMES)}`,
                },
            },
        },
        why: 'Counts only failures that are the diary\'s fault: model errors, invalid output, the agent running out of steps.',
    },
];

// Burn rate = how fast the error budget is going, relative to the pace that would use exactly
// all of it in 28 days. 6x sustained over 6 hours is the classic "slow burn" alert: fast enough
// to matter, slow enough not to fire on one unlucky request. With one user and a handful of
// requests a day, though, a single failure in a quiet 6 hours can still cross it.
export const BURN_ALERT = { lookback: '21600s', threshold: 6 };

export const alertPolicy = (slo, sloName, channelName) => ({
    displayName: `SLO burn: ${slo.displayName}`,
    combiner: 'OR',
    conditions: [{
        displayName: `Error budget burning over ${BURN_ALERT.threshold}x for ${Number.parseInt(BURN_ALERT.lookback, 10) / 3600} h`,
        conditionThreshold: {
            filter: `select_slo_burn_rate("${sloName}", "${BURN_ALERT.lookback}")`,
            comparison: 'COMPARISON_GT',
            thresholdValue: BURN_ALERT.threshold,
            duration: '0s',
        },
    }],
    notificationChannels: channelName ? [channelName] : [],
    alertStrategy: { autoClose: '86400s' },
    documentation: {
        mimeType: 'text/markdown',
        content: `**${slo.displayName}** is spending its error budget ${BURN_ALERT.threshold}x faster than the SLO allows.\n\n${slo.why}\n\nLook at Trace explorer (filter on span status Error or on diary.outcome) and the gateway logs (llm_call, mcp_call) for the last 6 hours.`,
    },
});
