// Live tracing for the gateway, sent to Google Cloud Trace with OpenTelemetry.
//
// Two halves, the way OpenTelemetry is meant to be used:
// - The code that does the work (gemini.js, agent.js, mcp.js) only calls the OpenTelemetry API
//   through withSpan() below. With no SDK set up, as in tests and the evals, those calls do nothing.
// - index.js sets up the SDK once per instance (setUpTracing), which turns the same calls into
//   spans and sends them to Cloud Trace's OTLP endpoint.
//
// Privacy: diary text never goes into a span. Span attributes come from fixed names and from
// the metadata the gateway already logs (feature, model, outcome, token counts, tool names,
// latency), filtered through SAFE_LOG_FIELDS. Errors keep only their class name, never their
// message, and no exception events are recorded. tracing.test.js checks this with a
// canary string in every input, output and tool result.
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export const SERVICE = 'joes-diary-gateway';
export const TELEMETRY_ENDPOINT = 'https://telemetry.googleapis.com/v1/traces';
export const FLUSH_LIMIT_MS = 1500;

const tracer = () => trace.getTracer(SERVICE);

const errorType = (error) => (typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error');

// Error codes (Firebase's HttpsError and the gateway's own) that mean the caller got it wrong.
// They are recorded as error.type but do not mark the span as failed: see SERVER_FAILURES.
const CLIENT_ERROR_CODES = new Set(['invalid-argument', 'unauthenticated', 'permission-denied', 'resource-exhausted', 'not-found']);

// Runs fn(span) inside a span that ends however fn ends. On a throw the span is marked as an
// error with the error's class name only: messages can carry text, so they stay out.
export const withSpan = (name, { attributes = {}, kind = SpanKind.INTERNAL } = {}, fn) => tracer().startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
        return await fn(span);
    } catch (error) {
        span.setAttribute('error.type', errorType(error));
        if (Number.isInteger(error?.status)) span.setAttribute('http.response.status_code', error.status);
        if (error?.retryable != null) span.setAttribute('diary.retryable', Boolean(error.retryable));
        if (!CLIENT_ERROR_CODES.has(error?.code)) span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
    } finally {
        span.end();
    }
});

// A route name for a span, from a fixed set, so a made-up address cannot put text in a span
// name or create endless distinct names.
const ROUTES = ['/mcp', '/oauth/register', '/oauth/authorize/check', '/oauth/authorize', '/oauth/token', '/oauth/revoke', '/oauth/connections', '/oauth/connections/revoke'];
export const routeName = (path = '') => {
    if (ROUTES.includes(path)) return path.slice(1).replace(/\//g, ' ');
    if (path.startsWith('/.well-known/')) return 'well-known';
    return 'other';
};

// The metadata log fields that may also go on a span, as span attribute names. Everything
// else in a log entry is dropped. Counts and names only: no field here can hold diary text.
export const SAFE_LOG_FIELDS = {
    feature: 'diary.feature',
    promptVersion: 'diary.prompt_version',
    outcome: 'diary.outcome',
    model: 'gen_ai.request.model',
    modelVersion: 'gen_ai.response.model',
    inputTokens: 'gen_ai.usage.input_tokens',
    outputTokens: 'gen_ai.usage.output_tokens',
    toolCalls: 'diary.tool_calls',
    failedToolCalls: 'diary.failed_tool_calls',
    proposals: 'diary.proposals',
    finishReason: 'diary.finish_reason',
    tool: 'gen_ai.tool.name',
    ok: 'diary.ok',
    step: 'diary.oauth.step',
    grant: 'diary.oauth.grant',
};

// Outcomes that are the diary's fault. The others (bad input, signed out, limit reached, the
// user said no) are the caller's, and OpenTelemetry leaves those unmarked on a server span,
// like a 4xx: an error rate, and the SLO built on it, should count only what we can fix.
export const SERVER_FAILURES = new Set(['error', 'model_error', 'model_unavailable', 'invalid_json', 'schema_fail', 'step_limit', 'empty_answer']);

const safeValue = (value) => {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 80);
    return undefined;
};

// Copies the safe fields of a metadata log entry onto the request's span. index.js calls it
// next to every logger.info, so the span and the log line always agree.
export const annotateSpan = (entry, span = trace.getActiveSpan()) => {
    if (!span || !entry || typeof entry !== 'object') return;
    for (const [field, attribute] of Object.entries(SAFE_LOG_FIELDS)) {
        const value = safeValue(entry[field]);
        if (value !== undefined) span.setAttribute(attribute, value);
    }
    if (SERVER_FAILURES.has(entry.outcome)) span.setStatus({ code: SpanStatusCode.ERROR });
};

// One Gemini call as a GenAI client span, named by the OpenTelemetry GenAI conventions:
// "generate_content <model>". Token counts and finish reason, never the prompt or the reply.
export const traceGenerate = (model, call) => withSpan(`generate_content ${model}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'gen_ai.operation.name': 'generate_content', 'gen_ai.provider.name': 'gcp.gemini', 'gen_ai.request.model': model },
}, async (span) => {
    const result = await call();
    span.setAttributes({
        'gen_ai.response.model': result.modelVersion,
        ...(result.finishReason ? { 'gen_ai.response.finish_reasons': [result.finishReason] } : {}),
        ...(result.usage.inputTokens != null ? { 'gen_ai.usage.input_tokens': result.usage.inputTokens } : {}),
        ...(result.usage.outputTokens != null ? { 'gen_ai.usage.output_tokens': result.usage.outputTokens } : {}),
    });
    return result;
});

// One tool run (the Ask agent's or the MCP server's): "execute_tool <name>". The run's
// result says whether it worked; the arguments and the result stay out.
export const traceTool = (name, tier, run) => withSpan(`execute_tool ${name}`, {
    attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, ...(tier ? { 'diary.tool.tier': tier } : {}) },
}, async (span) => {
    const result = await run();
    span.setAttribute('diary.ok', !result?.error);
    if (result?.error) span.setStatus({ code: SpanStatusCode.ERROR });
    return result;
});

// An access token for the function's own service account, from the metadata server that
// every Google Cloud runtime has. Cached until a minute before it expires.
export const createTokenSource = ({ fetchImpl = fetch, now = Date.now } = {}) => {
    let cached = null;
    return async () => {
        if (cached && cached.expiresAt > now() + 60000) return cached.token;
        const response = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
            headers: { 'Metadata-Flavor': 'Google' },
        });
        if (!response.ok) throw new Error(`Metadata server returned HTTP ${response.status}`);
        const body = await response.json();
        cached = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 };
        return cached.token;
    };
};

/**
 * Sets up the SDK for this instance and returns { flush() }. Call it once, at cold start.
 * projectId: the Google Cloud project, which Cloud Trace requires as gcp.project_id.
 * exporter: tests pass an InMemorySpanExporter; otherwise OTLP over HTTP to Cloud Trace.
 * onExportError(name, status): called when Cloud Trace rejects a batch (status: the HTTP code).
 */
export const setUpTracing = ({ projectId, exporter = null, getToken = createTokenSource(), onExportError = () => {} }) => {
    const otlp = exporter || new OTLPTraceExporter({
        url: TELEMETRY_ENDPOINT,
        headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        timeoutMillis: 3000,
    });
    const reporting = {
        export: (spans, done) => otlp.export(spans, (result) => {
            if (result.code !== 0) onExportError(errorType(result.error), Number.isInteger(result.error?.code) ? result.error.code : null);
            done(result);
        }),
        shutdown: () => otlp.shutdown(),
        forceFlush: () => otlp.forceFlush?.() ?? Promise.resolve(),
    };
    const provider = new NodeTracerProvider({
        resource: resourceFromAttributes({ 'service.name': SERVICE, 'gcp.project_id': projectId }),
        spanProcessors: [new BatchSpanProcessor(reporting, { scheduledDelayMillis: 1000 })],
    });
    provider.register();
    return {
        // Cloud Run functions get almost no CPU once the response is sent, so each request
        // sends its spans before it answers. Capped, so a slow Cloud Trace never slows the diary
        // by more than FLUSH_LIMIT_MS; spans that miss it go with the next request.
        flush: () => Promise.race([provider.forceFlush().catch(() => {}), new Promise(resolve => setTimeout(resolve, FLUSH_LIMIT_MS).unref?.())]),
        shutdown: () => provider.shutdown(),
    };
};


// Runs one request as the root span of its own trace, then sends the spans.
export const traceRequest = async (tracing, name, attributes, fn) => {
    if (!tracing) return fn();
    try {
        return await withSpan(name, { kind: SpanKind.SERVER, attributes }, fn);
    } finally {
        await tracing.flush();
    }
};
