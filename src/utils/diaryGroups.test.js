import { describe, expect, it } from 'vitest';
import { findDiaryGroupForCalendarDate } from './diaryGroups';

const groups = {
    '2026-11-08': [{}],
    'Mon Nov 09 2026': [{}],
};

describe('findDiaryGroupForCalendarDate', () => {
    it('matches ISO and toDateString group ids by local day', () => {
        expect(findDiaryGroupForCalendarDate(groups, null, new Date(2026, 10, 8, 15))).toBe('2026-11-08');
        expect(findDiaryGroupForCalendarDate(groups, null, new Date(2026, 10, 9, 8))).toBe('Mon Nov 09 2026');
    });

    it('prefers the selected group when it is the same day', () => {
        const withDuplicate = { ...groups, 'Sun Nov 08 2026': [{}] };
        expect(findDiaryGroupForCalendarDate(withDuplicate, 'Sun Nov 08 2026', new Date(2026, 10, 8))).toBe('Sun Nov 08 2026');
    });

    it('returns null for an unknown day or an invalid date', () => {
        expect(findDiaryGroupForCalendarDate(groups, null, new Date(2026, 10, 10))).toBeNull();
        expect(findDiaryGroupForCalendarDate(groups, null, 'not a date')).toBeNull();
    });
});
