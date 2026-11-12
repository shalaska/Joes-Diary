import { describe, expect, it } from 'vitest';
import { dayPreview, noteCount, plainText } from './notePreview';

describe('note previews', () => {
    it('strips Markdown and HTML', () => {
        expect(plainText('# Title\n> **Bold** and _soft_ and `code`\n- item <b>x</b> [link](http://a.b)')).toBe('Title Bold and soft and code item x link');
    });

    it('previews the latest note and skips saved analyses and empty notes', () => {
        const entries = [
            { date: '2026-11-12T08:00:00', content: 'Morning **note**' },
            { date: '2026-11-12T20:00:00', content: 'Evening note' },
            { date: '2026-11-12T21:00:00', content: '# Gemini Analysis', type: 'analysis' },
            { date: '2026-11-12T22:00:00', content: '   ' },
        ];
        expect(dayPreview(entries)).toBe('Evening note');
        expect(noteCount(entries)).toBe(3);
        expect(dayPreview([{ date: 'x', content: '# Gemini Analysis', type: 'analysis' }])).toBe('');
    });
});
