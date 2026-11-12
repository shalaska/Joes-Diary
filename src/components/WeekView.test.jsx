// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import WeekView from './WeekView';
import Sidebar from './Sidebar';
import { groupWeeks } from '../utils/weeks';

// React marks the joins between text parts with empty comments.
const render = (element) => renderToString(element).replace(/<!-- -->/g, '');

const grouped = {
    'Mon Nov 09 2026': [{ date: '2026-11-09T08:00:00', content: 'Monday **note**' }],
    'Wed Nov 11 2026': [
        { date: '2026-11-11T08:00:00', content: 'Wednesday note' },
        { date: '2026-11-11T21:00:00', content: '# Gemini Analysis', type: 'analysis' },
    ],
};

describe('WeekView', () => {
    it('shows the week, its notes by day without saved analyses, and the analyze button', () => {
        const week = groupWeeks(grouped)[0];
        const html = render(<WeekView week={week} groupedEntries={grouped} dayMetadata={{}} onOpenDay={() => {}} analyzeWeek={async () => ''} onSaveReview={async () => {}} />);
        expect(html).toContain('Week of 9–15 Nov 2026');
        expect(html).toContain('Analyze my week');
        expect(html).toContain('Monday 9 November');
        expect(html).toContain('Wednesday note');
        expect(html).not.toContain('Gemini Analysis');
    });
});

describe('Sidebar week mode', () => {
    it('lists weeks with day and note counts', () => {
        const html = render(
            <Sidebar groupedEntries={grouped} dayMetadata={{}} onUpdateDayMetadata={() => {}} selectedDate={null} onSelectDate={() => {}}
                onAddEntry={() => {}} onDeleteDay={() => {}} currentView="week" onViewTrash={() => {}} onLogout={() => {}} userEmail="a@b.c"
                historyMode="weeks" weeks={groupWeeks(grouped)} selectedWeek="2026-11-09" />,
        );
        expect(html).toContain('9–15 Nov 2026');
        expect(html).toContain('2 days · 2 notes');
        expect(html).toContain('aria-pressed="true"');
    });
});
