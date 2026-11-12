// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import DailyAnchors from './DailyAnchors';
import GoalsView from './GoalsView';
import Sidebar from './Sidebar';

const render = (element) => renderToString(element).replace(/<!-- -->/g, '');
const noop = () => {};

describe('DailyAnchors', () => {
    it('shows the day\'s anchors and how many are done', () => {
        const html = render(<DailyAnchors anchors={[
            { id: 'a', title: 'Walk at lunch', completed: true },
            { id: 'b', title: 'Call home' },
        ]} onAdd={noop} onToggle={noop} onDelete={noop} />);
        expect(html).toContain('1 of 2 done');
        expect(html).toContain('Walk at lunch');
        expect(html).toContain('Add another anchor');
    });

    it('stops offering to add once the day has three anchors', () => {
        const three = ['x', 'y', 'z'].map(id => ({ id, title: id }));
        expect(render(<DailyAnchors anchors={three} onAdd={noop} onToggle={noop} onDelete={noop} />)).not.toContain('<form');
        expect(render(<DailyAnchors anchors={[]} onAdd={noop} onToggle={noop} onDelete={noop} />)).toContain('What would make this day count?');
    });
});

describe('GoalsView', () => {
    it('lists open goals by timeframe, hides achieved ones, and shows recent anchors', () => {
        const html = render(<GoalsView
            goals={[
                { id: '1', title: 'Run a 10k', timeframe: 'This month', notes: 'Three runs a week' },
                { id: '2', title: 'Ship the side project', timeframe: 'This year' },
                { id: '3', title: 'Old goal', timeframe: 'This week', completed: true },
            ]}
            anchors={[{ id: 'a', title: 'Stretch', date: '2026-11-12', completed: true }]}
            onAddGoal={noop} onUpdateGoal={noop} onDeleteGoal={noop} onOpenDay={noop}
        />);
        expect(html).toContain('2 open');
        expect(html.indexOf('This month')).toBeLessThan(html.indexOf('This year'));
        expect(html).toContain('Three runs a week');
        expect(html).toContain('Show achieved goals (1)');
        expect(html).not.toContain('Old goal');
        expect(html).toContain('Thu 12 Nov');
        expect(html).toContain('1 of 1 done');
    });
});

describe('Sidebar goals link', () => {
    it('shows Goals with the open count', () => {
        const html = render(<Sidebar groupedEntries={{}} dayMetadata={{}} onUpdateDayMetadata={noop} selectedDate={null} onSelectDate={noop}
            onAddEntry={noop} onDeleteDay={noop} currentView="goals" onViewTrash={noop} onLogout={noop} userEmail="a@b.c"
            onViewGoals={noop} openGoalCount={3} />);
        expect(html).toMatch(/Goals<\/span><span[^>]*>3<\/span>/);
    });
});
