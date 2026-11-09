// Helpers for the weekly model-bump job. Pure functions, unit tested.

// Only stable, general Flash models qualify: no previews, lite, tts, image,
// audio or "latest" aliases. Example match: gemini-3.8-flash.
const STABLE_FLASH = /^gemini-(\d+)\.(\d+)-flash$/;

export const parseFlashVersion = (name) => {
    const match = STABLE_FLASH.exec(name);
    return match ? [Number(match[1]), Number(match[2])] : null;
};

const compare = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);

export const newestStableFlash = (modelNames) => {
    let best = null;
    for (const name of modelNames) {
        const version = parseFlashVersion(name);
        if (version && (!best || compare(version, best.version) > 0)) best = { name, version };
    }
    return best?.name ?? null;
};

export const isNewer = (candidate, current) => {
    const a = parseFlashVersion(candidate);
    const b = parseFlashVersion(current);
    if (!a) return false;
    if (!b) return true;
    return compare(a, b) > 0;
};

export const readPinnedModel = (envText) => {
    const match = /^GEMINI_MODEL=(.+)$/m.exec(envText);
    return match ? match[1].trim() : null;
};

export const writePinnedModel = (envText, model) => {
    if (!/^GEMINI_MODEL=.*$/m.test(envText)) throw new Error('GEMINI_MODEL line not found');
    return envText.replace(/^GEMINI_MODEL=.*$/m, `GEMINI_MODEL=${model}`);
};
