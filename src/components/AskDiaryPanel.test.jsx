// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';

vi.mock('../services/llmGateway', () => ({ callLlmLong: vi.fn() }));

import AskDiaryPanel from './AskDiaryPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const todo = { id: 't1', kind: 'todo', text: 'Call Maya', priority: 'high', status: 'pending' };
const note = { id: 'n1', kind: 'note', day: '2026-11-12', text: 'Shoes arrived.', status: 'pending' };

let root;
let host;
const mount = (element) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(element));
    return host;
};
const button = (name) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name);

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
});

describe('AskDiaryPanel', () => {
    it('renders the question box and says nothing changes without a tap', () => {
        const html = renderToString(<AskDiaryPanel calendarContext={null} onOpenDay={noop} onClose={noop} />);
        expect(html).toContain('Ask my diary');
        expect(html).toContain('nothing changes until you tap Add');
        expect(html).not.toContain('Suggestions');
    });

    it('shows waiting suggestions as cards with what each one would add', () => {
        const html = renderToString(<AskDiaryPanel calendarContext={null} proposals={[todo, note]} onApplyProposal={noop} onDismissProposal={noop} onOpenDay={noop} onClose={noop} />).replace(/<!-- -->/g, '');
        expect(html).toContain('Suggestions waiting for you (2)');
        expect(html).toContain('To-do · High priority');
        expect(html).toContain('Note for Thu 12 Nov');
        expect(html).toContain('Add to-do');
        expect(html).toContain('Add note');
    });

    it('applies a suggestion only when Add is tapped, then confirms it', async () => {
        const applied = [];
        const dismissed = [];
        const Wrapper = () => {
            const [list, setList] = React.useState([todo, note]);
            const drop = (p) => setList(prev => prev.filter(x => x.id !== p.id));
            return (
                <AskDiaryPanel
                    calendarContext={null} proposals={list} onOpenDay={noop} onClose={noop}
                    onApplyProposal={async (p) => { applied.push(p.id); drop(p); }}
                    onDismissProposal={async (p) => { dismissed.push(p.id); drop(p); }}
                />
            );
        };
        mount(<Wrapper />);
        expect(applied).toEqual([]);

        await act(async () => { button('Add to-do').click(); });
        expect(applied).toEqual(['t1']);
        expect(host.textContent).toContain('Added to your to-dos: Call Maya');
        expect(host.textContent).toContain('Suggestions waiting for you (1)');

        await act(async () => { button('Dismiss').click(); });
        expect(dismissed).toEqual(['n1']);
        expect(host.textContent).not.toContain('Shoes arrived.');
    });

    it('keeps the card and says so when adding fails', async () => {
        mount(<AskDiaryPanel calendarContext={null} proposals={[todo]} onOpenDay={noop} onClose={noop} onApplyProposal={async () => { throw new Error('offline'); }} onDismissProposal={noop} />);
        await act(async () => { button('Add to-do').click(); });
        expect(host.textContent).toContain('That did not save. Try again.');
        expect(host.textContent).not.toContain('Added to your to-dos');
        expect(button('Add to-do').disabled).toBe(false);
    });
});
