// Week view: groups diary days into Monday-to-Sunday weeks, and turns a week into the input for
// the "Analyze my week" review. Days are the app's groupIds (Date#toDateString, or YYYY-MM-DD).

const MAX_WEEK_CHARS = 90000; // stays under the gateway's 100k input limit

export const parseGroupId = (groupId) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(groupId);
    const date = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(groupId);
    return Number.isNaN(date.getTime()) ? null : date;
};

const dayKey = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
].join('-');

// The Monday that starts the week holding this date, at local midnight.
export const mondayOf = (date) => {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
};

const parseWeekKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const sundayOf = (key) => {
    const sunday = parseWeekKey(key);
    sunday.setDate(sunday.getDate() + 6);
    return sunday;
};

// "9–15 Nov 2026", or "28 Dec 2026 – 3 Jan 2027" when the week spans months or years.
export const weekRangeLabel = (key) => {
    const start = parseWeekKey(key);
    const end = sundayOf(key);
    const dayMonth = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (start.getFullYear() !== end.getFullYear()) {
        return `${dayMonth(start)} ${start.getFullYear()} – ${dayMonth(end)} ${end.getFullYear()}`;
    }
    if (start.getMonth() !== end.getMonth()) return `${dayMonth(start)} – ${dayMonth(end)} ${end.getFullYear()}`;
    return `${start.getDate()}–${dayMonth(end)} ${end.getFullYear()}`;
};

const isNote = (entry) => entry.type !== 'analysis';

// Weeks that have entries, newest first: { key (Monday YYYY-MM-DD), days (groupIds, oldest first), noteCount }.
export const groupWeeks = (groupedEntries) => {
    const weeks = new Map();
    for (const [groupId, entries] of Object.entries(groupedEntries)) {
        const date = parseGroupId(groupId);
        if (!date) continue;
        const key = dayKey(mondayOf(date));
        if (!weeks.has(key)) weeks.set(key, []);
        weeks.get(key).push({ groupId, date, notes: entries.filter(isNote).length });
    }
    return [...weeks.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, days]) => ({
            key,
            days: days.sort((a, b) => a.date - b.date).map(d => d.groupId),
            noteCount: days.reduce((sum, d) => sum + d.notes, 0),
        }));
};

const stripMarkup = (text) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

// The review's input: one item per day with notes, oldest first, notes in the order written.
// Saved analyses are left out. If the week is too long, the longest days are cut, not dropped.
export const weekReviewInput = (week, groupedEntries) => {
    const days = week.days
        .map(groupId => {
            const notes = (groupedEntries[groupId] || []).filter(isNote)
                .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
                .map(e => stripMarkup(e.content)).filter(Boolean);
            const date = parseGroupId(groupId);
            return { day: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), text: notes.join('\n\n') };
        })
        .filter(d => d.text);

    let total = days.reduce((sum, d) => sum + d.text.length, 0);
    while (total > MAX_WEEK_CHARS) {
        const longest = days.reduce((a, b) => (b.text.length > a.text.length ? b : a));
        const cut = Math.min(total - MAX_WEEK_CHARS, longest.text.length - 1000);
        if (cut <= 0) break;
        longest.text = `${longest.text.slice(0, longest.text.length - cut - 1)}…`;
        total = days.reduce((sum, d) => sum + d.text.length, 0);
    }
    return { weekLabel: weekRangeLabel(week.key), days };
};

// Where a saved review goes: the latest day of the week that has entries.
export const reviewDayFor = (week) => week.days[week.days.length - 1];
