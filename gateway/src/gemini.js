import { traceGenerate } from './tracing.js';

// Minimal Gemini REST client. Uses fetch only, so it runs in Cloud Functions (Node 22)
// and is trivial to fake in tests.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class ModelError extends Error {
    constructor(message, { status, retryable = false } = {}) {
        super(message);
        this.name = 'ModelError';
        this.status = status;
        this.retryable = retryable;
    }
}

const request = async ({ apiKey, fetchImpl, timeoutMs, model, body }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        throw new ModelError(error.name === 'AbortError' ? 'Model timed out' : 'Model unreachable', { retryable: true });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new ModelError(`Model returned HTTP ${response.status}`, {
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
        });
    }

    const json = await response.json();
    const candidate = json.candidates?.[0];
    return {
        content: candidate?.content ?? { role: 'model', parts: [] },
        finishReason: candidate?.finishReason || null,
        usage: {
            inputTokens: json.usageMetadata?.promptTokenCount ?? null,
            // Thinking tokens are billed as output, so they count here (they are not in candidatesTokenCount).
            outputTokens: json.usageMetadata?.candidatesTokenCount == null && json.usageMetadata?.thoughtsTokenCount == null
                ? null
                : (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
            thinkingTokens: json.usageMetadata?.thoughtsTokenCount ?? null,
        },
        modelVersion: json.modelVersion || model,
    };
};

// Each call is a span when tracing is on (model, tokens, finish reason; never the text).
const generate = (args) => traceGenerate(args.model, () => request(args));

const textOf = (content) => (content.parts || []).map(part => part.text || '').join('');

// thinkingLevel ('low', 'medium', 'high'...) caps how much a thinking model reasons before it
// answers; left out, the model's own default applies. It may be a function of the model name,
// so a level meant for one model is not sent to another (e.g. a Flash-Lite override).
const thinkingConfigFor = (thinkingLevel, model) => {
    const level = typeof thinkingLevel === 'function' ? thinkingLevel(model) : thinkingLevel;
    return level ? { thinkingConfig: { thinkingLevel: level } } : {};
};

// One prompt in, one answer out (optionally JSON with a schema). Used by the single-shot features.
export const createGeminiClient = ({ apiKey, fetchImpl = fetch, timeoutMs = 30000, thinkingLevel = '' }) => async ({ model, prompt, schema }) => {
    const generationConfig = {
        ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
        ...thinkingConfigFor(thinkingLevel, model),
    };
    const result = await generate({
        apiKey, fetchImpl, timeoutMs, model,
        body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig },
    });
    return { text: textOf(result.content), finishReason: result.finishReason, usage: result.usage, modelVersion: result.modelVersion };
};

// One turn of a tool-using conversation, for the agent. Returns the model's content as sent,
// so the caller can append it to the history unchanged (Gemini 3 needs its thought signatures back).
export const createGeminiToolClient = ({ apiKey, fetchImpl = fetch, timeoutMs = 30000, thinkingLevel = '' }) => async ({ model, system, contents, functionDeclarations }) => {
    const result = await generate({
        apiKey, fetchImpl, timeoutMs, model,
        body: {
            systemInstruction: { parts: [{ text: system }] },
            contents,
            ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
            ...(thinkingConfigFor(thinkingLevel, model).thinkingConfig ? { generationConfig: thinkingConfigFor(thinkingLevel, model) } : {}),
        },
    });
    const calls = (result.content.parts || []).filter(part => part.functionCall).map(part => part.functionCall);
    return { ...result, text: textOf(result.content), calls };
};
