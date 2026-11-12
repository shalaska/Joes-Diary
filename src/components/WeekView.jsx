import React, { useState } from 'react';
import { CalendarDays, LoaderCircle, Save, Sparkles, X } from 'lucide-react';
import SimpleMarkdownRenderer from './SimpleMarkdownRenderer';
import { parseGroupId, weekRangeLabel, weekReviewInput } from '../utils/weeks';

const errorMessage = (error) => {
    if (error?.code === 'functions/resource-exhausted') return 'You have reached today\'s limit of AI calls.';
    if (error?.code === 'functions/deadline-exceeded') return 'That took too long. Please try again.';
    return 'I could not analyze this week right now. Please try again.';
};

const dayTitle = (groupId, dayMetadata) => dayMetadata?.[groupId]?.customTitle
    || (parseGroupId(groupId) || new Date(groupId)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

// One week of the diary: every note from Monday to Sunday, read-only, with "Analyze my week".
// Days open in the normal day view for editing.
const WeekView = ({ week, groupedEntries, dayMetadata, onOpenDay, analyzeWeek, onSaveReview }) => {
    const [review, setReview] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const analyze = async () => {
        if (loading) return;
        setLoading(true);
        setError('');
        setReview(null);
        setSaved(false);
        try {
            setReview(await analyzeWeek(weekReviewInput(week, groupedEntries)));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            await onSaveReview(week, review);
            setSaved(true);
        } finally {
            setSaving(false);
        }
    };

    const notesByDay = week.days
        .map(groupId => ({
            groupId,
            notes: (groupedEntries[groupId] || []).filter(e => e.type !== 'analysis')
                .slice().sort((a, b) => new Date(a.date) - new Date(b.date)),
        }))
        .filter(d => d.notes.length > 0);

    return (
        <div className="pb-20">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 border-b border-slate-200 pb-4 flex items-center gap-3">
                <CalendarDays className="text-indigo-600" size={30} />
                <span>Week of {weekRangeLabel(week.key)}</span>
            </h1>

            <div className="mb-10">
                {!review && !loading && (
                    <button
                        onClick={analyze}
                        disabled={notesByDay.length === 0}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl transition-colors font-medium border border-indigo-200 border-dashed disabled:opacity-50"
                    >
                        <Sparkles size={18} />
                        <span>Analyze my week</span>
                    </button>
                )}
                {loading && (
                    <div className="flex items-center gap-2 text-indigo-700 text-sm bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                        <LoaderCircle size={16} className="animate-spin" />
                        <span>Reading your week…</span>
                    </div>
                )}
                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                {review && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 relative">
                        <button onClick={() => setReview(null)} className="absolute top-3 right-3 text-indigo-400 hover:text-indigo-700" aria-label="Close review">
                            <X size={18} />
                        </button>
                        <div className="text-slate-800 text-sm leading-relaxed pr-6">
                            <SimpleMarkdownRenderer content={review} />
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={save}
                                disabled={saving || saved}
                                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60"
                            >
                                <Save size={16} />
                                <span>{saved ? 'Saved to the last day of the week' : 'Save to diary'}</span>
                            </button>
                            <button onClick={analyze} className="px-4 py-2 rounded-lg text-sm text-indigo-700 hover:bg-indigo-100">
                                Analyze again
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-10">
                {notesByDay.map(({ groupId, notes }) => (
                    <section key={groupId}>
                        <button
                            onClick={() => onOpenDay(groupId)}
                            className="text-lg font-semibold text-slate-900 hover:text-indigo-600 mb-3"
                            title="Open this day"
                        >
                            {dayTitle(groupId, dayMetadata)}
                        </button>
                        <div className="space-y-4">
                            {notes.map(note => (
                                <div key={note.date} className="bg-white rounded-xl border border-slate-200 p-4 text-slate-700 text-sm leading-relaxed">
                                    <SimpleMarkdownRenderer content={note.content} />
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};

export default WeekView;
