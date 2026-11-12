import React, { useState } from 'react';
import { Anchor, Check, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { groupGoals, recentAnchorDays, timeframeOptions } from '../utils/anchorsGoals';
import { parseGroupId } from '../utils/weeks';

const dayLabel = (day) => parseGroupId(day)?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) || day;

const GoalForm = ({ initial, timeframes, submitLabel, onSubmit, onCancel }) => {
    const [title, setTitle] = useState(initial?.title || '');
    const [timeframe, setTimeframe] = useState(initial?.timeframe || '');
    const [notes, setNotes] = useState(initial?.notes || '');

    const submit = (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSubmit({ title: title.trim(), timeframe: timeframe.trim(), notes: notes.trim() });
        if (!initial) {
            setTitle('');
            setTimeframe('');
            setNotes('');
        }
    };

    return (
        <form onSubmit={submit} className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    placeholder="A goal"
                    aria-label="Goal"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <input
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    list="goal-timeframes"
                    maxLength={60}
                    placeholder="Timeframe"
                    aria-label="Timeframe"
                    className="sm:w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <datalist id="goal-timeframes">
                    {timeframes.map(t => <option key={t} value={t} />)}
                </datalist>
            </div>
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Notes (optional): why it matters, what done looks like"
                aria-label="Notes"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <div className="flex gap-2">
                <button
                    type="submit"
                    disabled={!title.trim()}
                    className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                    {!initial && <Plus size={16} />}
                    <span>{submitLabel}</span>
                </button>
                {onCancel && (
                    <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
};

const GoalItem = ({ goal, timeframes, onUpdate, onDelete }) => {
    const [editing, setEditing] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    if (editing) {
        return (
            <li className="bg-white border border-indigo-200 rounded-xl p-4">
                <GoalForm
                    initial={goal}
                    timeframes={timeframes}
                    submitLabel="Save"
                    onSubmit={(changes) => {
                        onUpdate(goal.id, changes);
                        setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                />
            </li>
        );
    }

    return (
        <li className="group bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
            <button
                onClick={() => onUpdate(goal.id, { completed: !goal.completed })}
                className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${goal.completed
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-slate-300 hover:border-indigo-500'}`}
                aria-label={goal.completed ? `Reopen "${goal.title}"` : `Mark "${goal.title}" achieved`}
                aria-pressed={!!goal.completed}
            >
                {goal.completed && <Check size={14} />}
            </button>
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium break-words ${goal.completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{goal.title}</p>
                {goal.notes && <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap break-words">{goal.notes}</p>}
            </div>
            {confirmingDelete ? (
                <div className="flex items-center gap-1 text-sm">
                    <span className="text-slate-500">Delete?</span>
                    <button onClick={() => onDelete(goal.id)} className="px-2 py-1 rounded text-red-600 hover:bg-red-50 font-medium">Yes</button>
                    <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 rounded text-slate-600 hover:bg-slate-100">No</button>
                </div>
            ) : (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-50" aria-label={`Edit "${goal.title}"`}>
                        <Pencil size={15} />
                    </button>
                    <button onClick={() => setConfirmingDelete(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-50" aria-label={`Delete "${goal.title}"`}>
                        <Trash2 size={15} />
                    </button>
                </div>
            )}
        </li>
    );
};

// Goals by timeframe, finished goals, and the last two weeks of daily anchors.
const GoalsView = ({ goals, anchors, onAddGoal, onUpdateGoal, onDeleteGoal, onOpenDay }) => {
    const [showDone, setShowDone] = useState(false);
    const { open, done } = groupGoals(goals);
    const timeframes = timeframeOptions(goals);
    const anchorDays = recentAnchorDays(anchors);
    const openCount = open.reduce((sum, g) => sum + g.goals.length, 0);

    return (
        <div className="pb-20">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 border-b border-slate-200 pb-4 flex items-center gap-3">
                <Target className="text-indigo-600" size={30} />
                <span>Goals</span>
                <span className="text-sm font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{openCount} open</span>
            </h1>

            <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-8">
                <GoalForm timeframes={timeframes} submitLabel="Add goal" onSubmit={onAddGoal} />
            </div>

            {open.length === 0 && <p className="text-sm text-slate-500 mb-8">No open goals.</p>}
            <div className="space-y-8 mb-10">
                {open.map(({ timeframe, goals: list }) => (
                    <section key={timeframe || 'none'}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{timeframe || 'No timeframe'}</h2>
                        <ul className="space-y-2">
                            {list.map(goal => (
                                <GoalItem key={goal.id} goal={goal} timeframes={timeframes} onUpdate={onUpdateGoal} onDelete={onDeleteGoal} />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>

            {done.length > 0 && (
                <section className="mb-10">
                    <button onClick={() => setShowDone(v => !v)} className="text-sm text-slate-500 hover:text-indigo-600 mb-3">
                        {showDone ? 'Hide' : 'Show'} achieved goals ({done.length})
                    </button>
                    {showDone && (
                        <ul className="space-y-2">
                            {done.map(goal => (
                                <GoalItem key={goal.id} goal={goal} timeframes={timeframes} onUpdate={onUpdateGoal} onDelete={onDeleteGoal} />
                            ))}
                        </ul>
                    )}
                </section>
            )}

            <section>
                <h2 className="text-lg font-semibold text-slate-900 mb-1 flex items-center gap-2">
                    <Anchor size={18} className="text-amber-600" />
                    <span>Recent anchors</span>
                </h2>
                <p className="text-sm text-slate-500 mb-4">Set anchors at the top of each day.</p>
                {anchorDays.length === 0 && <p className="text-sm text-slate-500">No anchors yet.</p>}
                <ul className="space-y-3">
                    {anchorDays.map(({ day, anchors: list, done: doneCount }) => (
                        <li key={day} className="bg-white border border-slate-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                                <button onClick={() => onOpenDay(day)} className="text-sm font-semibold text-slate-900 hover:text-indigo-600" title="Open this day">
                                    {dayLabel(day)}
                                </button>
                                <span className="text-xs text-slate-500">{doneCount} of {list.length} done</span>
                            </div>
                            <ul className="space-y-1">
                                {list.map(anchor => (
                                    <li key={anchor.id} className={`text-sm flex items-center gap-2 ${anchor.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${anchor.completed ? 'bg-amber-500' : 'bg-slate-300'}`} />
                                        {anchor.title}
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
};

export default GoalsView;
