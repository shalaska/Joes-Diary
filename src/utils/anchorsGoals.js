// Daily anchors (a few things that make a day count) and goals. Both collections were first
// written by an earlier version of the app, so dates may be strings, numbers or Firestore Timestamps.
import { dayKey, parseGroupId } from './weeks';

export const MAX_ANCHORS_PER_DAY = 3;
export const DEFAULT_TIMEFRAMES = ['This week', 'This month', 'This quarter', 'This year'];

// Milliseconds since 1970 for anything date-like, or null.
export const toMillis = (value) => {
    if (value == null || value === '') return null;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    if (typeof value === 'number') return value;
    const date = parseGroupId(String(value));
    return date ? date.getTime() : null;
};

// YYYY-MM-DD (local) for anything date-like, or null.
export const toDayKey = (value) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const ms = toMillis(value);
    return ms == null ? null : dayKey(new Date(ms));
};

export const anchorDay = (anchor) => toDayKey(anchor.date) || toDayKey(anchor.createdAt);

const byCreated = (a, b) => (toMillis(a.createdAt) ?? 0) - (toMillis(b.createdAt) ?? 0);

export const anchorsForDay = (anchors, day) => anchors.filter(a => anchorDay(a) === day).sort(byCreated);

// Days with anchors, newest first: [{ day, anchors, done }].
export const recentAnchorDays = (anchors, limit = 14) => {
    const days = new Map();
    for (const anchor of anchors) {
        const day = anchorDay(anchor);
        if (!day) continue;
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(anchor);
    }
    return [...days.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, limit)
        .map(([day, list]) => ({ day, anchors: list.sort(byCreated), done: list.filter(a => a.completed).length }));
};

const timeframeRank = (timeframe) => {
    const t = String(timeframe || '').toLowerCase();
    const order = ['week', 'month', 'quarter', 'year'];
    const i = order.findIndex(word => t.includes(word));
    return i === -1 ? order.length : i;
};

// Open goals grouped by timeframe (shortest first), plus the finished ones, newest first.
export const groupGoals = (goals) => {
    const groups = new Map();
    for (const goal of goals.filter(g => !g.completed)) {
        const timeframe = String(goal.timeframe || '').trim();
        if (!groups.has(timeframe)) groups.set(timeframe, []);
        groups.get(timeframe).push(goal);
    }
    const open = [...groups.entries()]
        .sort(([a], [b]) => (timeframeRank(a) - timeframeRank(b)) || (a ? (b ? a.localeCompare(b) : -1) : 1))
        .map(([timeframe, list]) => ({ timeframe, goals: list.sort(byCreated) }));
    const done = goals.filter(g => g.completed).sort((a, b) => byCreated(b, a));
    return { open, done };
};

// Timeframes to suggest when adding a goal: the defaults plus any already in use.
export const timeframeOptions = (goals) => [...new Set([
    ...DEFAULT_TIMEFRAMES,
    ...goals.map(g => String(g.timeframe || '').trim()).filter(Boolean),
])];
