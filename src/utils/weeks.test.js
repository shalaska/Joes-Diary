import { describe, expect, it } from 'vitest';
import { groupWeeks, mondayOf, reviewDayFor, savedWeekReview, weekRangeLabel, weekReviewEntry, weekReviewInput } from './weeks';

const entry = (date, content, extra = {}) => ({ date, content, ...extra });

const GROUPED = {
    'Mon Nov 09 2026': [entry('2026-11-09T08:00:00', 'Monday <b>start</b>')],
    'Wed Nov 11 2026': [
        entry('2026-11-11T20:00:00', 'Evening note'),
        entry('2026-11-11T08:00:00', 'Morning note'),
        entry('2026-11-11T21:00:00', '# Gemini Analysis', { type: 'analysis' }),
    ],
    'Sun Nov 15 2026': [entry('2026-11-15T10:00:00', 'Sunday')],
    'Mon Nov 16 2026': [entry('2026-11-16T10:00:00', 'Next week')],
    '2026-11-03': [entry('2026-11-03T10:00:00', 'Old style id')],
    'not a date': [entry('2026-11-03T10:00:00', 'Ignored')],
};

describe('weeks', () => {
    it('starts weeks on Monday', () => {
        expect(mondayOf(new Date(2026, 10, 15)).getDate()).toBe(9);
        expect(mondayOf(new Date(2026, 10, 9)).getDate()).toBe(9);
        expect(mondayOf(new Date(2026, 10, 16)).getDate()).toBe(16);
    });

    it('groups days into weeks, newest first, counting notes but not analyses', () => {
        expect(groupWeeks(GROUPED)).toEqual([
            { key: '2026-11-16', days: ['Mon Nov 16 2026'], noteCount: 1 },
            { key: '2026-11-09', days: ['Mon Nov 09 2026', 'Wed Nov 11 2026', 'Sun Nov 15 2026'], noteCount: 4 },
            { key: '2026-11-02', days: ['2026-11-03'], noteCount: 1 },
        ]);
    });

    it('labels week ranges', () => {
        expect(weekRangeLabel('2026-11-09')).toBe('9–15 Nov 2026');
        expect(weekRangeLabel('2026-11-30')).toBe('30 Nov – 6 Dec 2026');
        expect(weekRangeLabel('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
    });

    it('builds the review input day by day, oldest note first, without analyses or markup', () => {
        const week = groupWeeks(GROUPED)[1];
        const input = weekReviewInput(week, GROUPED);
        expect(input.weekLabel).toBe('9–15 Nov 2026');
        expect(input.days.map(d => d.day)).toEqual(['Mon 9 Nov', 'Wed 11 Nov', 'Sun 15 Nov']);
        expect(input.days[0].text).toBe('Monday start');
        expect(input.days[1].text).toBe('Morning note\n\nEvening note');
        expect(reviewDayFor(week)).toBe('Sun Nov 15 2026');
    });

    it('cuts the longest days when a week is too long for the gateway', () => {
        const big = {
            'Mon Nov 09 2026': [entry('2026-11-09T08:00:00', 'a'.repeat(80000))],
            'Tue Nov 10 2026': [entry('2026-11-10T08:00:00', 'b'.repeat(30000))],
        };
        const input = weekReviewInput(groupWeeks(big)[0], big);
        const total = input.days.reduce((sum, d) => sum + d.text.length, 0);
        expect(total).toBeLessThanOrEqual(90000);
        expect(input.days[1].text).toHaveLength(30000);
        expect(input.days[0].text.endsWith('…')).toBe(true);
    });

    it('saves a review as an analysis on the last day, and finds it again', () => {
        const week = groupWeeks(GROUPED)[1];
        const entry = weekReviewEntry(week, '## The week in brief\nGood week.', '2026-11-15T22:00:00.000Z');
        expect(entry).toEqual({
            date: '2026-11-15T22:00:00.000Z',
            content: '# Week of 9–15 Nov 2026\n\n## The week in brief\nGood week.',
            groupId: 'Sun Nov 15 2026',
            type: 'analysis',
            weekKey: '2026-11-09',
        });
        expect(savedWeekReview(week, GROUPED)).toBeNull();

        const older = { ...entry, date: '2026-11-15T20:00:00.000Z', weekKey: undefined, content: '# Week of 9–15 Nov 2026\n\nOld review' };
        const withOld = { ...GROUPED, 'Sun Nov 15 2026': [...GROUPED['Sun Nov 15 2026'], older] };
        expect(savedWeekReview(week, withOld)).toEqual({ entry: older, review: 'Old review' });

        const withBoth = { ...GROUPED, 'Sun Nov 15 2026': [...withOld['Sun Nov 15 2026'], entry] };
        expect(savedWeekReview(week, withBoth).review).toBe('## The week in brief\nGood week.');
        expect(savedWeekReview(groupWeeks(GROUPED)[0], withBoth)).toBeNull();
    });
});
