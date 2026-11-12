// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import DiaryEntry from './DiaryEntry';

const render = (element) => renderToString(element).replace(/<!-- -->/g, '');
const noop = () => {};

describe('DiaryEntry', () => {
    it('marks a saved analysis and leaves out the note actions', () => {
        const html = render(<DiaryEntry date="2026-11-12T21:00:00" initialContent="# Gemini Analysis" onSave={noop} onDelete={noop} showDateHeader={false} isAnalysis />);
        expect(html).toContain('Saved analysis');
        expect(html).not.toContain('Ask Gemini');
        expect(html).not.toContain('Create Todos');
    });

    it('keeps the note actions, labelled for screen readers on phones', () => {
        const html = render(<DiaryEntry date="2026-11-12T08:00:00" initialContent="A note" onSave={noop} onDelete={noop} showDateHeader={false} />);
        expect(html).toContain('aria-label="Ask Gemini"');
        expect(html).toContain('aria-label="Create Todos"');
        expect(html).not.toContain('Saved analysis');
    });
});
