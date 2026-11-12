import { describe, expect, it } from 'vitest';
import { anchorDay, anchorsForDay, groupGoals, recentAnchorDays, timeframeOptions, toDayKey } from './anchorsGoals';

const timestamp = (date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0, toDate: () => date });

describe('anchors and goals', () => {
    it('reads dates in every shape the older version may have stored', () => {
        expect(toDayKey('2026-11-12')).toBe('2026-11-12');
        expect(toDayKey('Thu Nov 12 2026')).toBe('2026-11-12');
        expect(toDayKey(new Date(2026, 10, 12, 9).toISOString())).toBe('2026-11-12');
        expect(toDayKey(new Date(2026, 10, 12, 9).getTime())).toBe('2026-11-12');
        expect(toDayKey(timestamp(new Date(2026, 10, 12, 9)))).toBe('2026-11-12');
        expect(toDayKey({ seconds: new Date(2026, 10, 12, 9).getTime() / 1000 })).toBe('2026-11-12');
        expect(toDayKey('nonsense')).toBeNull();
        expect(toDayKey(undefined)).toBeNull();
    });

    it('falls back to createdAt when an anchor has no date', () => {
        expect(anchorDay({ createdAt: '2026-11-10T08:00:00' })).toBe('2026-11-10');
    });

    it('lists a day\'s anchors in the order they were made', () => {
        const anchors = [
            { id: 'b', title: 'Second', date: '2026-11-12', createdAt: '2026-11-12T09:00:00' },
            { id: 'a', title: 'First', date: 'Thu Nov 12 2026', createdAt: timestamp(new Date(2026, 10, 12, 8)) },
            { id: 'c', title: 'Other day', date: '2026-11-11', createdAt: '2026-11-11T09:00:00' },
        ];
        expect(anchorsForDay(anchors, '2026-11-12').map(a => a.id)).toEqual(['a', 'b']);
        expect(recentAnchorDays(anchors)).toEqual([
            expect.objectContaining({ day: '2026-11-12', done: 0 }),
            expect.objectContaining({ day: '2026-11-11', done: 0 }),
        ]);
        expect(recentAnchorDays(anchors, 1)).toHaveLength(1);
    });

    it('groups open goals by timeframe, shortest first, and keeps achieved ones apart', () => {
        const goals = [
            { id: '1', title: 'Year goal', timeframe: 'This year', createdAt: '2026-01-01' },
            { id: '2', title: 'Week goal', timeframe: 'weekly', createdAt: '2026-11-01' },
            { id: '3', title: 'Loose goal', createdAt: '2026-11-02' },
            { id: '4', title: 'Custom', timeframe: 'Before summer', createdAt: '2026-11-03' },
            { id: '5', title: 'Done', timeframe: 'This month', completed: true, createdAt: '2026-10-01' },
        ];
        const { open, done } = groupGoals(goals);
        expect(open.map(g => g.timeframe)).toEqual(['weekly', 'This year', 'Before summer', '']);
        expect(done.map(g => g.id)).toEqual(['5']);
        expect(timeframeOptions(goals)).toEqual(['This week', 'This month', 'This quarter', 'This year', 'weekly', 'Before summer']);
    });
});
