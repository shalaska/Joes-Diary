import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, X } from 'lucide-react';

const FloatingGeminiMenu = ({ position, onAsk, onClose, isLoading, selectedText }) => {
    const [query, setQuery] = useState('');
    const menuRef = useRef(null);

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
        }
    };

    return (
        <div
            ref={menuRef}
            style={{
                top: position.top,
                left: position.left,
                position: 'absolute',
                zIndex: 50,
            }}
            className="floating-gemini-menu bg-white rounded-xl shadow-lg border border-slate-100 p-2 animate-fade-in flex flex-col gap-2 min-w-[300px]"
        >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 mb-1">
                <Sparkles size={16} className="text-indigo-600" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gemini Actions</span>
                <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600">
                    <X size={14} />
                </button>
            </div>

            {selectedText && (
                <div className="px-1 text-xs text-slate-400 italic truncate max-w-[280px] border-l-2 border-indigo-100 pl-2 mb-1">
                    "{selectedText}"
                </div>
            )}

            {isLoading ? (
                <div className="p-2 text-sm text-indigo-600 flex items-center gap-2">
                    <span className="animate-pulse">Thinking...</span>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ask about or edit selection..."
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white transition-all"
                        autoFocus
                    />
                    <button
                        type="submit"
                        className="bg-indigo-600 text-white p-1.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        disabled={!query.trim()}
                    >
                        <ArrowRight size={16} />
                    </button>
                </form>
            )}
        </div>
    );
};

export default FloatingGeminiMenu;
