// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import TodoSection from './TodoSection';

const todos = [
    { id: 'a', text: 'Book dentist', priority: 'high', completed: false, sortIndex: 1 },
    { id: 'b', text: 'Call Maya', priority: 'medium', completed: false, sortIndex: 2, source: 'claude' },
];
const noop = () => {};

describe('TodoSection', () => {
    for (const isPage of [false, true]) {
        it(`marks only the to-dos Claude added (${isPage ? 'page' : 'sidebar'})`, () => {
            const html = renderToString(<TodoSection todos={todos} onToggle={noop} onDelete={noop} onAdd={noop} onReorder={noop} isPage={isPage} />);
            expect(html).toContain('Book dentist');
            expect(html.match(/by Claude/g)).toHaveLength(1);
            expect(html.indexOf('by Claude')).toBeGreaterThan(html.indexOf('Call Maya'));
        });
    }
});
