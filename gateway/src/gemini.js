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

const generate = async ({ apiKey, fetchImpl, timeoutMs, model, body }) => {
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
            outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
        },
        modelVersion: json.modelVersion || model,
    };
};

const textOf = (content) => (content.parts || []).map(part => part.text || '').join('');

// One prompt in, one answer out (optionally JSON with a schema). Used by the single-shot features.
export const createGeminiClient = ({ apiKey, fetchImpl = fetch, timeoutMs = 30000 }) => async ({ model, prompt, schema }) => {
    const generationConfig = schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {};
    const result = await generate({
        apiKey, fetchImpl, timeoutMs, model,
        body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig },
    });
    return { text: textOf(result.content), finishReason: result.finishReason, usage: result.usage, modelVersion: result.modelVersion };
};

// One turn of a tool-using conversation, for the agent. Returns the model's content as sent,
// so the caller can append it to the history unchanged (Gemini 3 needs its thought signatures back).
export const createGeminiToolClient = ({ apiKey, fetchImpl = fetch, timeoutMs = 30000 }) => async ({ model, system, contents, functionDeclarations }) => {
    const result = await generate({
        apiKey, fetchImpl, timeoutMs, model,
        body: {
            systemInstruction: { parts: [{ text: system }] },
            contents,
            ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
        },
    });
    const calls = (result.content.parts || []).filter(part => part.functionCall).map(part => part.functionCall);
    return { ...result, text: textOf(result.content), calls };
};
