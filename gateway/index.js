// Joe's Diary LLM gateway: the only place that talks to Gemini.
//
// - Callable function, so Firebase verifies the caller's ID token before this code runs.
// - Only accounts on the allowedUsers list may call it (same allowlist as the Firestore rules).
// - The Gemini key lives in Secret Manager, never in the browser.
// - The model version is pinned by config, and every call logs one metadata-only line.
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createAskHandler } from './src/agent.js';
import { createGeminiClient, createGeminiToolClient } from './src/gemini.js';
import { createHandler, GatewayError } from './src/handler.js';

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_MODEL = defineString('GEMINI_MODEL', {
    description: 'Exact Gemini model version, e.g. gemini-2.5-flash. Never a "latest" alias.',
});

const GEMINI_MODEL_TODOS = defineString('GEMINI_MODEL_TODOS', {
    default: '',
    description: 'Optional exact model for todo extraction. Blank = GEMINI_MODEL.',
});

const GEMINI_MODEL_CHAT = defineString('GEMINI_MODEL_CHAT', {
    default: '',
    description: 'Optional exact model for the thinking-partner chat. Blank = GEMINI_MODEL.',
});

const GEMINI_MODEL_ASK = defineString('GEMINI_MODEL_ASK', {
    default: '',
    description: 'Optional exact model for "Ask my diary" (the agent). Blank = GEMINI_MODEL.',
});

const GEMINI_THINKING = defineString('GEMINI_THINKING', {
    default: '',
    description: 'Thinking level (low, medium, high) for GEMINI_MODEL only. Blank = the model default.',
});

// The thinking level applies to the pinned model only, never to a per-feature override.
const thinkingFor = (model) => (model === GEMINI_MODEL.value() ? GEMINI_THINKING.value() : '');

const DAILY_CALL_LIMIT = 300;

const isAllowedUser = async (uid) => (await getFirestore().doc(`allowedUsers/${uid}`).get()).exists;

// Cost guard: at most DAILY_CALL_LIMIT AI calls per user per UTC day. Counters live in
// gatewayUsage/, which the Firestore rules deny to every client.
const takeDailyQuota = async (uid) => {
    const day = new Date().toISOString().slice(0, 10);
    const ref = getFirestore().doc(`gatewayUsage/${uid}_${day}`);
    return getFirestore().runTransaction(async (tx) => {
        const count = (await tx.get(ref)).get('count') || 0;
        if (count >= DAILY_CALL_LIMIT) return false;
        tx.set(ref, { count: FieldValue.increment(1), day }, { merge: true });
        return true;
    });
};

export const llm = onCall({
    region: 'europe-west1',
    secrets: [GEMINI_API_KEY],
    maxInstances: 2,
    timeoutSeconds: 120, // the agent loop may take up to about 90 s; single-shot features finish far sooner
    memory: '256MiB',
    cors: ['https://joesdiary-d8211.web.app', 'https://joesdiary-d8211.firebaseapp.com', /^https:\/\/joesdiary-d8211--pr-\d+-[a-z0-9]+\.web\.app$/, /^http:\/\/localhost:\d+$/],
}, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!(await isAllowedUser(uid))) throw new HttpsError('permission-denied', 'This account is not allowed to use the diary.');
    if (!(await takeDailyQuota(uid))) throw new HttpsError('resource-exhausted', `Daily limit of ${DAILY_CALL_LIMIT} AI calls reached.`);

    // "Ask my diary": the read-only agent. It reads only this user's own documents, through the
    // Admin SDK scoped to users/{uid}, and has no tool that writes.
    if (request.data?.feature === 'ask') {
        const db = getFirestore();
        const ask = createAskHandler({
            model: GEMINI_MODEL_ASK.value() || GEMINI_MODEL.value(),
            callTools: createGeminiToolClient({ apiKey: GEMINI_API_KEY.value(), timeoutMs: 25000, thinkingLevel: thinkingFor }),
            store: {
                entries: async () => (await db.collection(`users/${uid}/entries`).get()).docs.map(d => d.data()),
                todos: async () => (await db.collection(`users/${uid}/todos`).get()).docs.map(d => d.data()),
            },
            log: (entry) => logger.info('llm_call', entry),
        });
        try {
            return await ask(request.data?.input);
        } catch (error) {
            if (error instanceof GatewayError) throw new HttpsError(error.code, error.message);
            logger.error('llm_gateway_unexpected', { name: error?.name, feature: 'ask' });
            throw new HttpsError('internal', 'Gateway error');
        }
    }

    const handle = createHandler({
        model: GEMINI_MODEL.value(),
        featureModels: { extractTodos: GEMINI_MODEL_TODOS.value(), chat: GEMINI_MODEL_CHAT.value() },
        // 55s: a week review writes a long answer; the browser waits up to 120s for it.
        callModel: createGeminiClient({ apiKey: GEMINI_API_KEY.value(), timeoutMs: 55000, thinkingLevel: thinkingFor }),
        // Structured log line: metadata only, never prompts, inputs or outputs.
        log: (entry) => logger.info('llm_call', entry),
    });

    try {
        return await handle({ feature: request.data?.feature, input: request.data?.input });
    } catch (error) {
        if (error instanceof GatewayError) throw new HttpsError(error.code, error.message);
        logger.error('llm_gateway_unexpected', { name: error?.name });
        throw new HttpsError('internal', 'Gateway error');
    }
});
