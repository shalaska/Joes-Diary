import React, { useState } from 'react';
import { BookOpen, Check, ListTodo, LoaderCircle, NotebookPen, X } from 'lucide-react';
import { askDiary, splitCitations } from '../services/askDiaryService';
import { proposalDate } from '../utils/proposals';

const formatDay = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const errorMessage = (error) => {
    if (error?.code === 'functions/resource-exhausted') return 'You have reached today\'s limit of AI calls.';
    if (error?.code === 'functions/deadline-exceeded') return 'That took too long. Try a narrower question.';
    return 'I could not answer that right now. Please try again.';
};

const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const noteDayLabel = (day) => proposalDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// One suggestion from the agent. Nothing happens until Add is tapped; Dismiss drops it.
const ProposalCard = ({ proposal, onApply, onDismiss }) => {
    const [state, setState] = useState('idle'); // idle | busy | failed
    const isTodo = proposal.kind === 'todo';

    const run = async (action) => {
        if (state === 'busy') return;
        setState('busy');
        try {
            await action(proposal);
        } catch {
            setState('failed');
        }
    };

    return (
        <li className="bg-white border border-indigo-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 mb-1">
                {isTodo ? <ListTodo size={14} /> : <NotebookPen size={14} />}
                <span>{isTodo ? `To-do · ${PRIORITY_LABEL[proposal.priority] || PRIORITY_LABEL.medium}` : `Note for ${noteDayLabel(proposal.day)}`}</span>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{proposal.text}</p>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={() => run(onApply)}
                    disabled={state === 'busy'}
                    className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isTodo ? 'Add to-do' : 'Add note'}
                </button>
                <button
                    type="button"
                    onClick={() => run(onDismiss)}
                    disabled={state === 'busy'}
                    className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-indigo-100 disabled:opacity-50"
                >
                    Dismiss
                </button>
                {state === 'failed' && <span className="text-xs text-red-700">That did not save. Try again.</span>}
            </div>
        </li>
    );
};

// "Ask my diary": questions across every entry, answered by the agent in the gateway. Cited
// days are links that open that day. The agent cannot change the diary: it can suggest a to-do
// or a note, shown here as cards (proposals = the suggestions still waiting), and only a tap
// on Add applies one.
const AskDiaryPanel = ({ calendarContext, proposals = [], onNewProposals = () => {}, onApplyProposal, onDismissProposal, onOpenDay, onClose }) => {
    const [question, setQuestion] = useState('');
    const [asked, setAsked] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [added, setAdded] = useState([]); // what was added in this sitting, as confirmation lines

    const apply = async (proposal) => {
        await onApplyProposal(proposal);
        setAdded(prev => [...prev, proposal]);
    };

    const submit = async (e) => {
        e.preventDefault();
        const q = question.trim();
        if (!q || loading) return;
        setLoading(true);
        setError('');
        setResult(null);
        setAsked(q);
        try {
            const answer = await askDiary(q, calendarContext);
            setResult(answer);
            if (answer.proposals?.length) onNewProposals(answer.proposals);
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
            {(proposals.length > 0 || added.length > 0) && (
                <section className="mt-4" aria-label="Suggestions">
                    <p className="text-xs font-semibold text-indigo-900 mb-2">
                        {proposals.length > 0 ? `Suggestions waiting for you (${proposals.length})` : 'Suggestions'}
                    </p>
                    {added.length > 0 && (
                        <ul className="space-y-1 mb-2">
                            {added.map(p => (
                                <li key={p.id} className="flex items-start gap-1.5 text-sm text-slate-600">
                                    <Check size={15} className="mt-0.5 text-emerald-600 flex-shrink-0" />
                                    <span className="break-words min-w-0">{p.kind === 'todo' ? 'Added to your to-dos' : `Added to ${noteDayLabel(p.day)}`}: {p.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <ul className="space-y-2">
                        {proposals.map(p => (
                            <ProposalCard key={p.id} proposal={p} onApply={apply} onDismiss={onDismissProposal} />
                        ))}
                    </ul>
                </section>
            )}
            <p className="mt-3 text-xs text-indigo-400">Reads your diary to answer. It can suggest a to-do or a note, and nothing changes until you tap Add.</p>
        </div>
    );
};

export default AskDiaryPanel;
