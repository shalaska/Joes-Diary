// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import AskDiaryPanel from './AskDiaryPanel';

describe('AskDiaryPanel', () => {
    it('renders the question box and the read-only note', () => {
        const html = renderToString(<AskDiaryPanel calendarContext={null} onOpenDay={() => {}} onClose={() => {}} />);
        expect(html).toContain('Ask my diary');
        expect(html).toContain('can&#x27;t change anything');
    });
});
