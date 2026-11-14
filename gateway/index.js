// Joe's Diary LLM gateway: the only place that talks to Gemini.
//
// - Callable function, so Firebase verifies the caller's ID token before this code runs.
// - Only accounts on the allowedUsers list may call it (same allowlist as the Firestore rules).
// - The Gemini key lives in Secret Manager, never in the browser.
// - The model version is pinned by config, and every call logs one metadata-only line.
// - Every request is also a trace in Google Cloud Trace, built from the same metadata (tracing.js).
import { SpanStatusCode } from '@opentelemetry/api';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createAskHandler } from './src/agent.js';
import { createConnectorHandler, sendWebResponse, toWebRequest } from './src/connector.js';
import { createGeminiClient, createGeminiToolClient } from './src/gemini.js';
import { createHandler, GatewayError } from './src/handler.js';
import { createMcpHandler } from './src/mcp.js';
import { createOAuth, fetchClientMetadata } from './src/oauth.js';
import { createOAuthStore, createUserStore } from './src/store.js';
import { FEATURES } from './src/features.js';
import { annotateSpan, routeName, setUpTracing, traceRequest } from './src/tracing.js';

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

const GATEWAY_TRACING = defineString('GATEWAY_TRACING', {
    default: 'on',
    description: 'on: send each request as a trace to Google Cloud Trace (metadata only). off: no traces.',
});

// One tracing setup per instance, made on its first request. Off outside Google Cloud
// (K_SERVICE is set only there), so the emulator and tests send nothing.
let tracing;
const tracingFor = () => {
    if (tracing === undefined) {
        tracing = process.env.K_SERVICE && GATEWAY_TRACING.value() !== 'off'
            ? setUpTracing({ projectId: process.env.GCLOUD_PROJECT, onExportError: (name, status) => logger.warn('trace_export_failed', { name, status }) })
            : null;
    }
    return tracing;
};

// Each metadata log line also goes onto the request's span, through the same allowlist.
const logAndAnnotate = (event) => (entry) => {
    logger.info(event, entry);
    annotateSpan(entry);
};

// The feature name as the client sent it is only trusted when it is a known one.
const featureName = (feature) => (feature === 'ask' || Object.hasOwn(FEATURES, feature) ? feature : 'unknown');

// The thinking level applies to the pinned model only, never to a per-feature override.
const thinkingFor = (model) => (model === GEMINI_MODEL.value() ? GEMINI_THINKING.value() : '');

const DAILY_CALL_LIMIT = 300;

const isAllowedUser = async (uid) => (await getFirestore().doc(`allowedUsers/${uid}`).get()).exists;

// Cost guard: at most DAILY_CALL_LIMIT calls per user per UTC day, counted separately for the
// AI gateway and the MCP server (prefix). Counters live in gatewayUsage/, which the Firestore
// rules deny to every client.
const takeDailyQuota = async (uid, prefix = '') => {
    const day = new Date().toISOString().slice(0, 10);
    const ref = getFirestore().doc(`gatewayUsage/${prefix}${uid}_${day}`);
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
}, (request) => {
    const feature = featureName(request.data?.feature);
    return traceRequest(tracingFor(), `llm ${feature}`, { 'diary.feature': feature }, () => handleLlm(request));
});

async function handleLlm(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!(await isAllowedUser(uid))) throw new HttpsError('permission-denied', 'This account is not allowed to use the diary.');
    if (!(await takeDailyQuota(uid))) throw new HttpsError('resource-exhausted', `Daily limit of ${DAILY_CALL_LIMIT} AI calls reached.`);

    // "Ask my diary": the agent. It reads only this user's own documents, through the Admin SDK
    // scoped to users/{uid}. It cannot change them: its only write is a suggestion document in
    // users/{uid}/agentProposals, which the app shows for the user to add with one tap.
    if (request.data?.feature === 'ask') {
        const ask = createAskHandler({
            model: GEMINI_MODEL_ASK.value() || GEMINI_MODEL.value(),
            callTools: createGeminiToolClient({ apiKey: GEMINI_API_KEY.value(), timeoutMs: 25000, thinkingLevel: thinkingFor }),
            store: createUserStore(getFirestore(), uid),
            allowedTiers: ['read', 'propose'],
            log: logAndAnnotate('llm_call'),
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
        log: logAndAnnotate('llm_call'),
    });

    try {
        return await handle({ feature: request.data?.feature, input: request.data?.input });
    } catch (error) {
        if (error instanceof GatewayError) throw new HttpsError(error.code, error.message);
        logger.error('llm_gateway_unexpected', { name: error?.name });
        throw new HttpsError('internal', 'Gateway error');
    }
}

// The diary as an MCP server for Claude (Phase 3), with its own OAuth sign-in server. Firebase
// Hosting sends /mcp, /oauth/* and /.well-known/* on the diary's address here, so the server,
// the sign-in endpoints and the consent page (/connect, in the app) share one address.
// It never calls Gemini: the outside app's own model does the thinking.
const DIARY_URL = 'https://joesdiary-d8211.web.app';

let connector;
const connectorHandler = () => {
    if (connector) return connector;
    const db = getFirestore();
    const log = logAndAnnotate('mcp_call');
    const oauth = createOAuth({
        base: DIARY_URL,
        store: createOAuthStore(db),
        verifyIdToken: async (idToken) => (await getAuth().verifyIdToken(idToken, true)).uid,
        isAllowedUser,
        fetchClientMetadata,
        log,
    });
    const mcpHandler = createMcpHandler({
        authenticate: oauth.authenticate,
        storeFor: (uid) => createUserStore(db, uid),
        allowRequest: (uid) => takeDailyQuota(uid, 'mcp_'),
        resourceMetadataUrl: `${DIARY_URL}/.well-known/oauth-protected-resource/mcp`,
        log,
    });
    connector = createConnectorHandler({ oauth, mcp: mcpHandler });
    return connector;
};

export const mcp = onRequest({
    region: 'europe-west1',
    maxInstances: 2,
    timeoutSeconds: 30, // Claude wants a token answer within 10 s; tool calls only read Firestore
    memory: '256MiB',
    invoker: 'public', // Firebase Hosting rewrites need it; every route checks its own token
}, async (req, res) => {
    // The spans are sent before the answer: once it is sent, the instance gets almost no CPU.
    const response = await traceRequest(tracingFor(), `mcp ${routeName(req.path)}`, { 'http.request.method': req.method }, async (span) => {
        try {
            const answer = await connectorHandler()(toWebRequest(req, DIARY_URL));
            span.setAttribute('http.response.status_code', answer.status);
            if (answer.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
            return answer;
        } catch (error) {
            logger.error('mcp_unexpected', { name: error?.name });
            span.setAttributes({ 'http.response.status_code': 500, 'error.type': error?.name || 'Error' });
            span.setStatus({ code: SpanStatusCode.ERROR });
            return null;
        }
    });
    if (response) await sendWebResponse(res, response);
    else res.status(500).set('Cache-Control', 'no-store').json({ error: 'server_error' });
});
