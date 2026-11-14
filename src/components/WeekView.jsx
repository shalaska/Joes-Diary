import React, { useState } from 'react';
import { CalendarDays, Check, LoaderCircle, Sparkles } from 'lucide-react';
import SimpleMarkdownRenderer from './SimpleMarkdownRenderer';
import { parseGroupId, savedWeekReview, weekRangeLabel, weekReviewInput } from '../utils/weeks';

const errorMessage = (error) => {
    if (error?.code === 'functions/resource-exhausted') return 'You have reached today\'s limit of AI calls.';
    if (error?.code === 'functions/deadline-exceeded') return 'That took too long. Please try again.';
    return 'I could not analyze this week right now. Please try again.';
};

const dayTitle = (groupId, dayMetadata) => dayMetadata?.[groupId]?.customTitle
    || (parseGroupId(groupId) || new Date(groupId)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

// One week of the diary: every note from Monday to Sunday, read-only, with "Analyze my week".
// A review saves itself to the diary as soon as it arrives, and shows again when the week is reopened.
// Analyzing again replaces the saved review. Days open in the normal day view for editing.
const WeekView = ({ week, groupedEntries, reviews, dayMetadata, onOpenDay, analyzeWeek, onSaveReview }) => {
    const saved = savedWeekReview(week, reviews ?? groupedEntries);
    const [review, setReview] = useState(saved?.review || null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [saveState, setSaveState] = useState(saved ? 'saved' : 'idle'); // idle | saving | saved | failed

    const save = async (text) => {
        setSaveState('saving');
        try {
            await onSaveReview(week, text, saved?.entry || null);
            setSaveState('saved');
        } catch {
            setSaveState('failed');
        }
    };

    const analyze = async () => {
        if (loading) return;
        setLoading(true);
        setError('');
        try {
            const text = await analyzeWeek(weekReviewInput(week, groupedEntries));
            setReview(text);
            setLoading(false);
            await save(text);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setLoading(false);
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
                    <div className="flex items-center gap-2 text-indigo-700 text-sm bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-3">
                        <LoaderCircle size={16} className="animate-spin" />
                        <span>Reading your week…</span>
                    </div>
                )}
                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                {review && !loading && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
                        {saved?.entry?.source === 'claude' && review === saved.review && (
                            <p className="text-[11px] text-slate-400 mb-2">Written by Claude</p>
                        )}
                        <div className="text-slate-800 text-sm leading-relaxed">
                            <SimpleMarkdownRenderer content={review} />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
                            {saveState === 'saving' && (
                                <span className="flex items-center gap-1.5 text-indigo-700"><LoaderCircle size={14} className="animate-spin" />Saving…</span>
                            )}
                            {saveState === 'saved' && (
                                <span className="flex items-center gap-1.5 text-emerald-700">
                                    <Check size={14} />
                                    Saved to this week
                                </span>
                            )}
                            {saveState === 'failed' && (
                                <>
                                    <span className="text-red-700">This review couldn't be saved.</span>
                                    <button onClick={() => save(review)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
                                        Try saving again
                                    </button>
                                </>
                            )}
                            <button
                                onClick={analyze}
                                disabled={saveState === 'saving'}
                                className="ml-auto px-4 py-2 rounded-lg text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                                title="Writes a new review and replaces the saved one"
                            >
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
