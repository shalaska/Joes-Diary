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

export const createGeminiClient = ({ apiKey, fetchImpl = fetch, timeoutMs = 30000 }) => async ({ model, prompt, schema }) => {
    const generationConfig = schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
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

    const body = await response.json();
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map(part => part.text || '').join('') ?? '';
    return {
        text,
        finishReason: candidate?.finishReason || null,
        usage: {
            inputTokens: body.usageMetadata?.promptTokenCount ?? null,
            outputTokens: body.usageMetadata?.candidatesTokenCount ?? null,
        },
        modelVersion: body.modelVersion || model,
    };
};
