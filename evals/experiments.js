// Prompt experiments: the same eval cases run through two or more versions of a feature, then
// compared side by side in Arize (evals/arizeExperiments.js uploads them).
//
// An eval run answers "did this change make things worse?" against a saved baseline. An
// experiment answers "which of these versions is better?", case by case, before anything ships.
// Run one from GitHub: Actions > Evals > Run workflow > experiment.
//
// A variant changes a case's input. Chat and edit already accept a custom prompt (the
// Settings page uses the same inputs), so a variant can try a new prompt without touching
// the gateway. A variant may also pin a different model.
import { DEFAULT_SYSTEM_PROMPT } from '../gateway/src/features.js';

// The candidate keeps everything in the live prompt and replaces its "How to sound" rules,
// which target the chat's weakest judge score: tone (4.4 of 5 in evals/baseline.json).
const CHAT_V4_TONE = DEFAULT_SYSTEM_PROMPT.replace(/How to sound:[\s\S]*?\n\nRespond with/, `How to sound:
- Write the way the person writes: match their register, length and level of formality.
- Open with the most useful sentence you have: the question, the observation or the answer.
  Never open with a reflection of their feelings ("It sounds like", "It seems like", "I hear you"),
  with praise ("Great question", "What a lovely note") or with a summary of what they wrote.
- Be specific: quote or name one concrete thing from the note.
- No therapy-speak ("hold space", "be kind to yourself", "self-care", "valid"), no exclamation marks,
  no emoji, and no advice they did not ask for. Suggest a professional only if the note describes a
  risk to their safety.
- Two or three sentences unless they asked for a list or a breakdown.
- If they asked a direct question, answer it first.
- Use only what is in the note and context. Never invent people, events, feelings or deadlines.

Respond with`);

export const EXPERIMENTS = {
    'chat-tone': {
        feature: 'chat',
        description: 'Live chat prompt vs a candidate with stricter tone rules (no reflective openers, no praise, match the writer).',
        repeats: 3,
        variants: [
            { name: 'chat-v3-live', input: (input) => input },
            { name: 'chat-v4-tone', input: (input) => ({ ...input, systemPrompt: CHAT_V4_TONE }) },
        ],
    },
};

export const findVariant = (experimentName, variantName) => {
    const experiment = EXPERIMENTS[experimentName];
    if (!experiment) throw new Error(`Unknown experiment "${experimentName}". Known: ${Object.keys(EXPERIMENTS).join(', ')}`);
    const variant = experiment.variants.find(v => v.name === variantName);
    if (!variant) throw new Error(`Unknown variant "${variantName}" in ${experimentName}. Known: ${experiment.variants.map(v => v.name).join(', ')}`);
    return { experiment, variant };
};
