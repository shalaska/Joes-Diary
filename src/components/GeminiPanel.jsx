import React from 'react';
import { Sparkles, ArrowRight, PlusCircle, MessageSquarePlus } from 'lucide-react';

const GeminiPanel = ({ suggestion, isLoading, onApplyTool, onClose, onReply, onAddToNote, isWaitingForPrompt, onAsk, saveLabel = "Add to Note" }) => {
    const [initialPrompt, setInitialPrompt] = React.useState('');
    const [replyText, setReplyText] = React.useState('');

    if (!suggestion && !isLoading && !isWaitingForPrompt) return null;

    const panelRef = React.useRef(null);

    React.useEffect(() => {
        if ((isWaitingForPrompt || isLoading || suggestion) && panelRef.current) {
            panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [isWaitingForPrompt, isLoading, suggestion]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (replyText.trim()) {
            onReply(replyText);
            setReplyText('');
        }
    };

    const handleInitialSubmit = (e) => {
        e.preventDefault();
        if (onAsk) {
            onAsk(initialPrompt);
            setInitialPrompt('');
        }
    };

    return (
        <div ref={panelRef} className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl p-4 animate-fade-in relative">
            <div className="flex items-start gap-3">
                <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
                    <Sparkles size={18} />
                </div>
                <div className="flex-1">
                    {isWaitingForPrompt ? (
                        <div className="animate-fade-in">
                            <p className="text-indigo-900 font-medium mb-2">What would you like to know?</p>
                            <form onSubmit={handleInitialSubmit} className="flex gap-2">
                                <input
                                    type="text"
                                    value={initialPrompt}
                                    onChange={(e) => setInitialPrompt(e.target.value)}
                                    placeholder="Leave empty for general analysis..."
                                    className="flex-1 px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:border-indigo-400 text-sm"
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                                >
                                    Ask
                                </button>
                            </form>
                        </div>
                    ) : isLoading ? (
                        <div className="flex items-center gap-2 text-indigo-800 font-medium">
                            <span className="animate-pulse">Gemini is thinking...</span>
                        </div>
                    ) : (
                        <>
                            <p className="text-indigo-900 leading-relaxed mb-3">
                                {suggestion.content}
                            </p>

                            <div className="flex flex-wrap gap-2 mb-3">
                                {suggestion.tool && (
                                    <button
                                        onClick={() => onApplyTool(suggestion.tool)}
                                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        <PlusCircle size={16} />
                                        {suggestion.tool.label}
                                    </button>
                                )}

                                {onAddToNote && (
                                    <button
                                        onClick={onAddToNote}
                                        className="flex items-center gap-2 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                        title="Add conversation to note"
                                    >
                                        <MessageSquarePlus size={16} />
                                        {saveLabel}
                                    </button>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
                                <input
                                    type="text"
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    placeholder="Reply to Gemini..."
                                    className="flex-1 px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:border-indigo-400 text-sm"
                                />
                                <button
                                    type="submit"
                                    disabled={!replyText.trim()}
                                    className="bg-white text-indigo-600 p-2 rounded-lg border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ArrowRight size={16} />
                                </button>
                            </form>
                        </>
                    )}
                </div>
                {!isLoading && (
                    <button onClick={onClose} className="text-indigo-400 hover:text-indigo-600">
                        <span className="sr-only">Dismiss</span>
                        &times;
                    </button>
                )}
            </div>
        </div>
    );
};

export default GeminiPanel;
