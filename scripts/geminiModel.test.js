import { describe, expect, it } from 'vitest';
import { isNewer, newestStableFlash, parseFlashVersion, readFeatureModels, readPinnedModel, writePinnedModel } from './geminiModel.js';

describe('newestStableFlash', () => {
    it('picks the highest stable Flash model and ignores previews, lite, tts, image and aliases', () => {
        const names = [
            'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-3.8-flash',
            'gemini-3.8-flash-lite', 'gemini-3.8-flash-tts', 'gemini-3.10-flash-preview', 'gemini-3.1-flash-image',
            'gemini-3.10-pro', 'gemini-3.7-flash',
        ];
        expect(newestStableFlash(names)).toBe('gemini-3.8-flash');
    });

    it('compares minor versions numerically, not as text', () => {
        expect(newestStableFlash(['gemini-3.9-flash', 'gemini-3.10-flash'])).toBe('gemini-3.10-flash');
    });

    it('returns null when nothing qualifies', () => {
        expect(newestStableFlash(['gemini-flash-latest', 'gemini-4.0-flash-preview'])).toBeNull();
    });
});

describe('isNewer', () => {
    it('only moves forward', () => {
        expect(isNewer('gemini-3.9-flash', 'gemini-3.8-flash')).toBe(true);
        expect(isNewer('gemini-3.8-flash', 'gemini-3.8-flash')).toBe(false);
        expect(isNewer('gemini-3.7-flash', 'gemini-3.8-flash')).toBe(false);
        expect(isNewer('gemini-4.0-flash', 'gemini-3.8-flash')).toBe(true);
    });

    it('treats an unparseable current pin as replaceable, and never picks an unparseable candidate', () => {
        expect(isNewer('gemini-3.8-flash', 'something-else')).toBe(true);
        expect(isNewer('gemini-flash-latest', 'gemini-3.8-flash')).toBe(false);
        expect(parseFlashVersion('gemini-flash-latest')).toBeNull();
    });
});

describe('pinned model in the env file', () => {
    const env = '# comment\nGEMINI_MODEL=gemini-3.8-flash\nOTHER=1\n';

    it('reads and rewrites only the GEMINI_MODEL line', () => {
        expect(readPinnedModel(env)).toBe('gemini-3.8-flash');
        expect(writePinnedModel(env, 'gemini-3.9-flash')).toBe('# comment\nGEMINI_MODEL=gemini-3.9-flash\nOTHER=1\n');
    });

    it('refuses to write when the line is missing', () => {
        expect(() => writePinnedModel('OTHER=1\n', 'gemini-3.9-flash')).toThrow();
    });
});

describe('readFeatureModels', () => {
    it('maps per-feature lines to features and ignores missing ones', () => {
        expect(readFeatureModels('GEMINI_MODEL=a\nGEMINI_MODEL_TODOS=gemini-3.1-flash-lite\n')).toEqual({ extractTodos: 'gemini-3.1-flash-lite' });
        expect(readFeatureModels('GEMINI_MODEL=a\n')).toEqual({});
    });
});
