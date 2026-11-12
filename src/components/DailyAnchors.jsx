import React, { useState } from 'react';
import { Anchor, Check, Plus, X } from 'lucide-react';
import { MAX_ANCHORS_PER_DAY } from '../utils/anchorsGoals';

// The day's anchors: up to three things that would make the day count, ticked off as they happen.
const DailyAnchors = ({ anchors, onAdd, onToggle, onDelete }) => {
    const [text, setText] = useState('');
    const canAdd = anchors.length < MAX_ANCHORS_PER_DAY;
    const done = anchors.filter(a => a.completed).length;

    const add = (e) => {
        e.preventDefault();
        const title = text.trim();
        if (!title || !canAdd) return;
        onAdd(title);
        setText('');
    };

    return (
        <section className="mb-8 bg-amber-50/60 border border-amber-100 rounded-xl p-4" aria-label="Daily anchors">
            <div className="flex items-center gap-2 mb-3 text-amber-800">
                <Anchor size={16} />
                <h2 className="text-sm font-semibold">Anchors</h2>
                {anchors.length > 0 && (
                    <span className="text-xs text-amber-700/80">{done} of {anchors.length} done</span>
                )}
            </div>

            {anchors.length > 0 && (
                <ul className="space-y-1.5 mb-3">
                    {anchors.map(anchor => (
                        <li key={anchor.id} className="group flex items-center gap-3">
                            <button
                                onClick={() => onToggle(anchor.id, !anchor.completed)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${anchor.completed
                                    ? 'bg-amber-500 border-amber-500 text-white'
                                    : 'border-amber-300 hover:border-amber-500'}`}
                                aria-label={anchor.completed ? `Mark "${anchor.title}" not done` : `Mark "${anchor.title}" done`}
                                aria-pressed={!!anchor.completed}
                            >
                                {anchor.completed && <Check size={14} />}
                            </button>
                            <span className={`flex-1 text-sm ${anchor.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                {anchor.title}
                            </span>
                            <button
                                onClick={() => onDelete(anchor.id)}
                                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                aria-label={`Remove "${anchor.title}"`}
                            >
                                <X size={16} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {canAdd && (
                <form onSubmit={add} className="flex gap-2">
                    <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        maxLength={200}
                        placeholder={anchors.length === 0 ? 'What would make this day count?' : 'Add another anchor'}
                        className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-amber-400"
                    />
                    <button
                        type="submit"
                        disabled={!text.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50"
                    >
                        <Plus size={16} />
                        <span>Add</span>
                    </button>
                </form>
            )}
        </section>
    );
};

export default DailyAnchors;
