import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

// Every AI feature goes through the server-side gateway (gateway/index.js). The browser never
// sees a Gemini key, and the gateway pins the model, validates output and logs metadata only.
const functions = getFunctions(app, 'europe-west1');
const llm = httpsCallable(functions, 'llm', { timeout: 60000 });

export const callLlm = async (feature, input) => {
    const { data } = await llm({ feature, input });
    return data.output;
};

// The diary agent can take several model calls, so it gets a longer client timeout.
const llmLong = httpsCallable(functions, 'llm', { timeout: 120000 });

export const callLlmLong = async (feature, input) => {
    const { data } = await llmLong({ feature, input });
    return data.output;
};
