import { findDiaryGroupForCalendarDate } from './diaryGroups';

// Suggestions from the "ask my diary" agent (users/{uid}/agentProposals). The agent can only
// suggest: a to-do, or a new note for a day. Nothing changes until the user taps Add, and a
// suggestion that is not answered expires (the gateway sets expiresAt, seven days on).
const KINDS = ['todo', 'note'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const wellFormed = (p) => KINDS.includes(p?.kind) && typeof p.text === 'string' && p.text.trim().length > 0
    && (p.kind !== 'note' || DAY.test(String(p.day)));

const past = (iso, now) => Boolean(iso) && Date.parse(iso) <= now;

// Still waiting for an answer, newest first.
export const pendingProposals = (proposals, now = Date.now()) => proposals
    .filter(p => p.status === 'pending' && wellFormed(p) && !past(p.expiresAt, now))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

// Past their expiry, answered or not: safe to delete.
export const staleProposals = (proposals, now = Date.now()) => proposals.filter(p => past(p.expiresAt, now));

export const proposalDate = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
};

// The diary day a suggested note goes to: that day's existing group, or a new one for it.
export const noteGroupId = (day, groupedEntries, selectedGroupId) => (
    findDiaryGroupForCalendarDate(groupedEntries, selectedGroupId, proposalDate(day)) || proposalDate(day).toDateString()
);

// A suggested note becomes a new entry of its own. It never replaces or edits an entry.
export const proposalNoteEntry = (proposal, groupId, date = new Date().toISOString()) => ({
    date,
    content: proposal.text.trim(),
    groupId,
});

export const proposalTodo = (proposal) => ({
    text: proposal.text.trim(),
    priority: ['high', 'medium', 'low'].includes(proposal.priority) ? proposal.priority : 'medium',
    completed: false,
});
