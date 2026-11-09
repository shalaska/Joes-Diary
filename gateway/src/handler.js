import { FEATURES } from './features.js';
import { ModelError } from './gemini.js';

// One request in, one validated result out, one metadata log line either way.
// The log never contains prompts, inputs or outputs: only what is needed for evals,
// cost tracking and SLOs (Phase 1, 4 and 5 of the roadmap).

export class GatewayError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'GatewayError';
        this.code = code; // 'invalid-argument' | 'unavailable' | 'internal'
    }
}

const stripFences = (text) => text.replace(/^\s*```(?:json|markdown)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

export const createHandler = ({ callModel, model, log, now = () => Date.now() }) => {
    if (!model || /latest/i.test(model)) {
        throw new Error('The gateway needs an exact, pinned model version, not a "latest" alias.');
    }

    return async ({ feature, input }) => {
        const spec = FEATURES[feature];
        if (!spec) throw new GatewayError('invalid-argument', 'Unknown feature');
        if (!spec.validateInput(input)) throw new GatewayError('invalid-argument', 'Invalid input');

        const promptVersion = spec.promptVersionFor ? spec.promptVersionFor(input) : spec.promptVersion;
        const started = now();
        const entry = { feature, promptVersion, model, outcome: 'error', latencyMs: null, inputTokens: null, outputTokens: null };

        try {
            const result = await callModel({ model, prompt: spec.buildPrompt(input), schema: spec.schema });
            entry.latencyMs = now() - started;
            entry.inputTokens = result.usage.inputTokens;
            entry.outputTokens = result.usage.outputTokens;
            entry.modelVersion = result.modelVersion;
            entry.finishReason = result.finishReason;

            const text = stripFences(result.text);
            let output = text;
            if (spec.output === 'json') {
                try {
                    output = JSON.parse(text);
                } catch {
                    entry.outcome = 'invalid_json';
                    throw new GatewayError('internal', 'Model returned invalid JSON');
                }
            }
            if (!spec.validateOutput(output)) {
                entry.outcome = 'schema_fail';
                throw new GatewayError('internal', 'Model output failed validation');
            }

            entry.outcome = 'ok';
            return { output, promptVersion, model };
        } catch (error) {
            if (entry.latencyMs === null) entry.latencyMs = now() - started;
            if (error instanceof ModelError) {
                entry.outcome = error.retryable ? 'model_unavailable' : 'model_error';
                throw new GatewayError(error.retryable ? 'unavailable' : 'internal', error.message);
            }
            throw error;
        } finally {
            log(entry);
        }
    };
};
