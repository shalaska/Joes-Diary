import { describe, expect, it } from 'vitest';
import { noteGroupId, pendingProposals, proposalNoteEntry, proposalTodo, staleProposals } from './proposals';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const todo = { id: 'a', kind: 'todo', text: 'Call Maya', priority: 'high', status: 'pending', createdAt: '2026-11-13T10:00:00.000Z', expiresAt: '2026-11-20T10:00:00.000Z' };
const note = { id: 'b', kind: 'note', day: '2026-11-12', text: ' Shoes arrived. ', status: 'pending', createdAt: '2026-11-13T11:00:00.000Z', expiresAt: '2026-11-20T11:00:00.000Z' };

describe('proposals', () => {
    it('keeps only well-formed, unanswered, unexpired suggestions, newest first', () => {
        const list = [
            todo, note,
            { ...todo, id: 'c', status: 'applied' },
            { ...todo, id: 'd', expiresAt: '2026-11-13T11:59:00.000Z' },
            { ...todo, id: 'e', kind: 'delete' },
            { ...note, id: 'f', day: 'tomorrow' },
            { ...todo, id: 'g', text: '  ' },
        ];
        expect(pendingProposals(list, NOW).map(p => p.id)).toEqual(['b', 'a']);
        expect(staleProposals(list, NOW).map(p => p.id)).toEqual(['d']);
    });

    it('turns a suggested to-do into a to-do with a known priority', () => {
        expect(proposalTodo(todo)).toEqual({ text: 'Call Maya', priority: 'high', completed: false });
        expect(proposalTodo({ ...todo, priority: 'urgent' }).priority).toBe('medium');
    });

    it('adds a suggested note as a new entry in that day, without touching other entries', () => {
        const existing = new Date(2026, 10, 12).toDateString();
        expect(noteGroupId('2026-11-12', { [existing]: [{ date: 'x', content: 'old' }] }, null)).toBe(existing);
        expect(noteGroupId('2026-11-10', { [existing]: [] }, existing)).toBe(new Date(2026, 10, 10).toDateString());
        expect(proposalNoteEntry(note, existing, '2026-11-13T12:00:00.000Z')).toEqual({ date: '2026-11-13T12:00:00.000Z', content: 'Shoes arrived.', groupId: existing });
    });
});
