import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, X, MessageCircle } from 'lucide-react';

const FloatingGeminiMenu = ({ position, onAsk, onDiscuss, onClose, isLoading, selectedText }) => {
    const [query, setQuery] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const menuRef = useRef(null);
    const [lastSelection, setLastSelection] = useState({ selectedText, position });

    // Reset state when the selection or menu position changes.
    if (lastSelection.selectedText !== selectedText || lastSelection.position !== position) {
        setLastSelection({ selectedText, position });
        setIsExpanded(false);
        setQuery('');
    }

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    if (!position) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (query.trim()) {
            onAsk(query);
            setQuery('');
            setIsExpanded(false);
        }
    };

    // Collapsed State: Small Icon
    if (!isExpanded) {
        return (
            <div
                style={{
                    top: position.top,
                    left: position.left,
                    right: position.right,
                    bottom: position.bottom,
                    position: position.position || 'absolute',
                    zIndex: 50,
                    transform: position.transform || 'none',
                }}
                className="animate-fade-in"
            >
                <button
                    onMouseDown={(e) => e.preventDefault()} // Prevent stealing focus
                    onClick={() => setIsExpanded(true)}
                    className="bg-white text-indigo-600 p-2 rounded-full shadow-lg border border-indigo-100 hover:scale-110 transition-transform flex items-center justify-center group"
                    title="Ask Gemini"
                >
                    <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
                </button>
            </div>
        );
    }

    // Expanded State: Full Menu
    return (
        <div
            ref={menuRef}
            style={{
                top: position.top,
                left: position.left,
                right: position.right,
                bottom: position.bottom,
                position: position.position || 'absolute',
                zIndex: 50,
                transform: position.transform || 'none',
            }}
            className="floating-gemini-menu bg-white rounded-xl shadow-xl border border-slate-100 p-2 animate-fade-in flex flex-col gap-2 min-w-[320px] max-w-[90vw]"
        >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 mb-1">
                <Sparkles size={16} className="text-indigo-600" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gemini Actions</span>
                <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600">
                    <X size={14} />
                </button>
            </div>

            {selectedText && (
                <div className="px-1 text-xs text-slate-400 italic truncate max-w-full border-l-2 border-indigo-100 pl-2 mb-1">
                    "{selectedText}"
                </div>
            )}

            {isLoading ? (
                <div className="p-2 text-sm text-indigo-600 flex items-center gap-2">
                    <span className="animate-pulse">Thinking...</span>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="flex gap-2 items-center">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ask or edit..."
                        className="flex-1 min-w-[120px] px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white transition-all"
                        autoFocus
                    />
                    <div className="flex gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                onDiscuss(query);
                                setQuery('');
                                setIsExpanded(false);
                            }}
                            className="bg-indigo-50 text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                            title="Discuss in Chat"
                        >
                            <MessageCircle size={16} />
                        </button>
                        <button
                            type="submit"
                            className="bg-indigo-600 text-white p-1.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            disabled={!query.trim()}
                            title="Quick Edit/Answer"
                        >
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default FloatingGeminiMenu;
