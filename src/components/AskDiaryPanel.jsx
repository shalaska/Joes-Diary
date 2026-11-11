import React, { useState } from 'react';
import { BookOpen, LoaderCircle, X } from 'lucide-react';
import { askDiary, splitCitations } from '../services/askDiaryService';

const formatDay = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const errorMessage = (error) => {
    if (error?.code === 'functions/resource-exhausted') return 'You have reached today\'s limit of AI calls.';
    if (error?.code === 'functions/deadline-exceeded') return 'That took too long. Try a narrower question.';
    return 'I could not answer that right now. Please try again.';
};

// "Ask my diary": questions across every entry, answered by the read-only agent in the gateway.
// Cited days are links that open that day. The agent cannot change anything.
const AskDiaryPanel = ({ calendarContext, onOpenDay, onClose }) => {
    const [question, setQuestion] = useState('');
    const [asked, setAsked] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        const q = question.trim();
        if (!q || loading) return;
        setLoading(true);
        setError('');
        setResult(null);
        setAsked(q);
        try {
            setResult(await askDiary(q, calendarContext));
            setQuestion('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl p-4 animate-fade-in relative">
            <button onClick={onClose} className="absolute top-3 right-3 text-indigo-400 hover:text-indigo-700" aria-label="Close">
                <X size={18} />
            </button>
            <div className="flex items-center gap-2 mb-3 text-indigo-900">
                <BookOpen size={18} />
                <p className="font-medium">Ask my diary</p>
            </div>
            <form onSubmit={submit} className="flex gap-2">
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. When did I last feel stuck at work?"
                    maxLength={2000}
                    className="flex-1 px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:border-indigo-400 text-sm"
                    autoFocus
                />
                <button
                    type="submit"
                    disabled={loading || !question.trim()}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                    Ask
                </button>
            </form>
            {loading && (
                <div className="flex items-center gap-2 mt-4 text-indigo-700 text-sm">
                    <LoaderCircle size={16} className="animate-spin" />
                    <span>Searching your diary…</span>
                </div>
            )}
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
            {result && (
                <div className="mt-4">
                    <p className="text-xs text-indigo-500 mb-1">{asked}</p>
                    <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                        {splitCitations(result.answer).map((part, i) => (part.day
                            ? (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => onOpenDay(part.day)}
                                    className="text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-700"
                                >
                                    {formatDay(part.day)}
                                </button>
                            )
                            : <React.Fragment key={i}>{part.text}</React.Fragment>))}
                    </p>
                </div>
            )}
            <p className="mt-3 text-xs text-indigo-400">Reads your diary to answer. It can't change anything.</p>
        </div>
    );
};

export default AskDiaryPanel;
