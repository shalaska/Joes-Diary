// Sends each eval run to Arize as OpenTelemetry traces, using the OpenInference conventions
// that LLM tools (Arize, Phoenix) understand. It is on only when ARIZE_API_KEY and
// ARIZE_SPACE_ID are set (CI has them as repository secrets); otherwise every helper here is
// a no-op and the run behaves exactly as before.
//
// What a trace holds: one root span per eval case (the synthetic input, the answer, pass or
// fail), an LLM span per model call (model, tokens, the prompt and the reply), an EVALUATOR
// span per code check, and one for the judge with its own LLM call inside. Every case in one
// run shares a session id, so Arize can show the run as one session.
//
// Only eval data is ever traced: invented cases and the model's answers to them. This file is
// never imported by the gateway, so nothing from the live diary can reach Arize through it.
import { diag, DiagConsoleLogger, DiagLogLevel, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OpenInferenceSpanKind, SEMRESATTRS_PROJECT_NAME, SemanticConventions as SC } from '@arizeai/openinference-semantic-conventions';

// US spaces use otlp.arize.com; a space in another region uses otlp.<region>.arize.com, which
// ARIZE_REGION (e.g. eu-west-1a) selects. The region shows in the Arize app's address.
export const arizeEndpoint = (region = '') => (region ? `https://otlp.${region}.arize.com/v1/traces` : 'https://otlp.arize.com/v1/traces');
export const PROJECT = 'joes-diary-evals';
const MAX_TEXT = 20000;

const text = (value) => {
    const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
};

// The header names Arize documents for OTLP over HTTP.
export const arizeHeaders = ({ ARIZE_API_KEY, ARIZE_SPACE_ID }) => ({ space_id: ARIZE_SPACE_ID, api_key: ARIZE_API_KEY });

// "Forbidden: invalid Space ID": the OTLP error's message plus the readable part of the reply.
const describeError = (error) => {
    const detail = String(error?.data ?? '').replace(/[^\x20-\x7e]/g, '').trim();
    return [error?.message || 'export failed', detail].filter(Boolean).join(': ');
};

// Counts what the exporter sent and what failed, so the CI log says whether Arize took the spans.
const countingExporter = (inner) => {
    const stats = { spans: 0, failures: 0, lastError: '' };
    return {
        stats,
        export: (spans, done) => inner.export(spans, (result) => {
            if (result.code === 0) stats.spans += spans.length;
            else { stats.failures += 1; stats.lastError = describeError(result.error); }
            done(result);
        }),
        shutdown: () => inner.shutdown(),
        forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
    };
};

const noop = { enabled: false, tracer: trace.getTracer(PROJECT), sessionId: null, shutdown: async () => '' };

/**
 * env: ARIZE_API_KEY, ARIZE_SPACE_ID (both, or tracing stays off), ARIZE_REGION, GITHUB_RUN_ID.
 * exporter: tests pass an InMemorySpanExporter instead of the network one.
 * Returns { enabled, tracer, sessionId, shutdown() -> a one-line summary for the log }.
 */
export const createEvalTracing = ({ env = process.env, exporter = null, now = Date.now } = {}) => {
    if (!exporter && !(env.ARIZE_API_KEY && env.ARIZE_SPACE_ID)) return noop;
    if (!exporter) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
    const counted = countingExporter(exporter || new OTLPTraceExporter({ url: arizeEndpoint(env.ARIZE_REGION), headers: arizeHeaders(env) }));
    const provider = new NodeTracerProvider({
        resource: resourceFromAttributes({ [SEMRESATTRS_PROJECT_NAME]: PROJECT, 'service.name': PROJECT }),
        spanProcessors: [exporter ? new SimpleSpanProcessor(counted) : new BatchSpanProcessor(counted)],
    });
    // Registers the async context manager, so spans started inside a case become its children.
    provider.register();
    return {
        enabled: true,
        tracer: provider.getTracer(PROJECT),
        sessionId: env.GITHUB_RUN_ID ? `gh-${env.GITHUB_RUN_ID}` : `local-${now()}`,
        // Never throws: a tracing problem is reported in the log but never fails the eval run.
        shutdown: async () => {
            try {
                await provider.shutdown();
            } catch (error) {
                counted.stats.failures += 1;
                counted.stats.lastError = describeError(error);
            }
            const { spans, failures, lastError } = counted.stats;
            return failures ? `Arize: ${spans} spans sent, ${failures} export(s) failed: ${lastError}` : `Arize: ${spans} spans sent to project ${PROJECT}.`;
        },
    };
};

// Runs fn inside a span that ends however fn ends, and marks the span as an error if it throws.
const inSpan = (tracer, name, attributes, fn) => tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
        return await fn(span);
    } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
    } finally {
        span.end();
    }
});

// Wraps a model client (either Gemini client) so each call is an LLM span.
export const traceModel = (call, tracer, purpose) => (request) => inSpan(tracer, `gemini ${purpose}`, {
    [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.LLM,
    [SC.LLM_PROVIDER]: 'google',
    [SC.LLM_MODEL_NAME]: request.model,
    [SC.INPUT_VALUE]: text(request.prompt ?? { system: request.system, contents: request.contents }),
    'eval.purpose': purpose,
}, async (span) => {
    const result = await call(request);
    const usage = result.usage || {};
    span.setAttributes({
        [SC.OUTPUT_VALUE]: text(result.calls?.length ? { text: result.text, toolCalls: result.calls } : result.text),
        ...(usage.inputTokens != null ? { [SC.LLM_TOKEN_COUNT_PROMPT]: usage.inputTokens } : {}),
        ...(usage.outputTokens != null ? { [SC.LLM_TOKEN_COUNT_COMPLETION]: usage.outputTokens } : {}),
        ...(usage.thinkingTokens != null ? { [SC.LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING]: usage.thinkingTokens } : {}),
        ...(usage.inputTokens != null && usage.outputTokens != null ? { [SC.LLM_TOKEN_COUNT_TOTAL]: usage.inputTokens + usage.outputTokens } : {}),
        ...(result.modelVersion ? { 'llm.response.model_version': result.modelVersion } : {}),
    });
    return result;
});

// One eval case as the root span of its own trace. fn returns the result row run.js builds;
// its checks become EVALUATOR spans under the case.
export const traceCase = (tracing, { feature, caseId, run, input, model }, fn) => {
    if (!tracing.enabled) return fn();
    return inSpan(tracing.tracer, `eval ${feature}/${caseId}`, {
        [SC.OPENINFERENCE_SPAN_KIND]: feature === 'ask' ? OpenInferenceSpanKind.AGENT : OpenInferenceSpanKind.CHAIN,
        [SC.SESSION_ID]: tracing.sessionId,
        [SC.INPUT_VALUE]: text(input),
        [SC.TAG_TAGS]: ['eval', feature],
        [SC.METADATA]: text({ feature, caseId, run, model }),
        'eval.feature': feature,
        'eval.case_id': caseId,
        'eval.run': run,
    }, async (span) => {
        const row = await fn();
        span.setAttributes({
            [SC.OUTPUT_VALUE]: text(row.output),
            'eval.pass': row.pass,
            'eval.outcome': row.outcome ?? 'none',
            ...(row.latencyMs != null ? { 'eval.latency_ms': row.latencyMs } : {}),
        });
        for (const check of row.checks || []) {
            if (check.name === 'judge') continue; // the judge already has its own span
            tracing.tracer.startSpan(`check ${check.name}`, {
                attributes: {
                    [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.EVALUATOR,
                    [SC.EVALUATION_NAME]: check.name,
                    [SC.EVALUATION_LABEL]: check.pass ? 'pass' : 'fail',
                    [SC.EVALUATION_SCORE]: check.pass ? 1 : 0,
                    [SC.EVALUATION_EXPLANATION]: text(check.detail ?? ''),
                    [SC.EVALUATION_ANNOTATOR_KIND]: 'CODE',
                },
            }).end();
        }
        if (!row.pass) span.setStatus({ code: SpanStatusCode.ERROR, message: 'eval case failed' });
        return row;
    });
};

// The LLM judge as an EVALUATOR span; its model call nests inside it.
export const traceJudge = (tracing, fn) => {
    if (!tracing.enabled) return fn();
    return inSpan(tracing.tracer, 'judge', {
        [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.EVALUATOR,
        [SC.EVALUATION_NAME]: 'judge',
        [SC.EVALUATION_ANNOTATOR_KIND]: 'LLM',
    }, async (span) => {
        const verdict = await fn();
        if (verdict && !verdict.error) {
            const scores = Object.values(verdict.scores || {});
            span.setAttributes({
                [SC.EVALUATION_LABEL]: verdict.pass ? 'pass' : 'fail',
                ...(scores.length ? { [SC.EVALUATION_SCORE]: Math.min(...scores) } : {}),
                [SC.EVALUATION_EXPLANATION]: text(verdict.reason ?? ''),
                ...Object.fromEntries(Object.entries(verdict.scores || {}).map(([k, v]) => [`judge.${k}`, v])),
            });
        }
        return verdict;
    });
};
