// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const store = new Map();
const ops = [];
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => path.join('/'),
    doc: (_db, ...path) => path.join('/'),
    getDocs: async (path) => ({ docs: [...store].filter(([k]) => k.startsWith(`${path}/`)).map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })) }),
    writeBatch: () => {
        const pending = [];
        return {
            set: (path, value) => pending.push(['set', path, value]),
            delete: (path) => pending.push(['delete', path]),
            commit: async () => pending.forEach(([op, path, value]) => { ops.push([op, path]); if (op === 'set') store.set(path, value); else store.delete(path); }),
        };
    },
}));

import ClaudeTrash from './ClaudeTrash';
import { loadClaudeTrash } from '../services/claudeTrash';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.parse('2026-11-14T07:00:00.000Z');

let root;
let host;
afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    store.clear();
    ops.length = 0;
});

describe('ClaudeTrash', () => {
    it('lists live deletes and clears expired ones', async () => {
        store.set('users/joe/todoTrash/a', { todo: { id: 'a', text: 'Book dentist' }, deletedAt: '2026-11-13', expiresAt: NOW + 1000 });
        store.set('users/joe/todoTrash/b', { todo: { id: 'b', text: 'Old' }, deletedAt: '2026-11-01', expiresAt: NOW - 1000 });
        const items = await loadClaudeTrash('joe', NOW);
        expect(items.map(i => i.id)).toEqual(['a']);
        expect(ops).toEqual([['delete', 'users/joe/todoTrash/b']]);
    });

    it('restores a to-do into the list and hands it back to the app', async () => {
        store.set('users/joe/todoTrash/a', { todo: { id: 'a', text: 'Book dentist' }, deletedAt: '2026-11-13', expiresAt: Date.now() + 864e5 });
        const onRestored = vi.fn();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<ClaudeTrash uid="joe" onRestored={onRestored} />));
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(host.textContent).toContain('Deleted by Claude');
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Restore')).click());
        expect(store.get('users/joe/todos/a')).toEqual({ id: 'a', text: 'Book dentist' });
        expect(store.has('users/joe/todoTrash/a')).toBe(false);
        expect(onRestored).toHaveBeenCalledWith({ id: 'a', text: 'Book dentist' });
        expect(host.textContent).not.toContain('Deleted by Claude');
    });
});
