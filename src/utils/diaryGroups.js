const toLocalDayKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
};

const groupIdDayKey = (groupId) => {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(groupId);
    if (dateOnlyMatch) return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
    return toLocalDayKey(groupId);
};

export const findDiaryGroupForCalendarDate = (groupedEntries, selectedGroupId, calendarDate) => {
    const targetDayKey = toLocalDayKey(calendarDate);
    if (!targetDayKey) return null;

    if (selectedGroupId && groupedEntries[selectedGroupId] && groupIdDayKey(selectedGroupId) === targetDayKey) {
        return selectedGroupId;
    }

    return Object.keys(groupedEntries).find(groupId => groupIdDayKey(groupId) === targetDayKey) || null;
};
