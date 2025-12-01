import React, { useState, useEffect, useRef } from 'react';
import { Save, Sparkles, Trash2 } from 'lucide-react';
import { askGemini } from '../services/geminiService';
import GeminiPanel from './GeminiPanel';

const DiaryEntry = ({ date, initialContent, onSave, onDelete, showDateHeader = true }) => {
    const [content, setContent] = useState(initialContent || '');
    const [isSaving, setIsSaving] = useState(false);
    const [geminiState, setGeminiState] = useState({ loading: false, suggestion: null });
    const textareaRef = useRef(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [content]);

    // Debounced auto-save
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (content !== initialContent) {
                setIsSaving(true);
                onSave(date, content);
                setTimeout(() => setIsSaving(false), 1000);
            }
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [content, date, onSave, initialContent]);

    const handleAskGemini = async () => {
        setGeminiState({ loading: true, suggestion: null });
        try {
            const suggestion = await askGemini(content);
            setGeminiState({ loading: false, suggestion });
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            setGeminiState({
                loading: false,
                suggestion: {
                    type: 'question',
                    content: "I'm having trouble thinking right now. Maybe try again in a moment?",
                }
            });
        }
    };

    const handleApplyTool = (tool) => {
        if (tool.action === 'insert' || tool.action === 'heading') {
            const newContent = content + (content.endsWith('\n') ? '' : '\n') + tool.value;
            setContent(newContent);
            // Clear suggestion after applying
            setGeminiState({ loading: false, suggestion: null });
        }
    };

    return (
        <div className="w-full max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mb-6 transition-all hover:shadow-md group">
            <div className="flex justify-between items-center mb-4">
                {showDateHeader ? (
                    <h2 className="text-2xl font-semibold text-slate-800">
                        {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h2>
                ) : (
                    <div className="text-sm font-medium text-slate-400">
                        {new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                )}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleAskGemini}
                        className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full text-sm font-medium transition-colors opacity-0 group-hover:opacity-100"
                        title="Ask Gemini"
                    >
                        <Sparkles size={14} />
                        <span>Ask Gemini</span>
                    </button>
                    <div className="flex items-center text-sm text-slate-400 w-24 justify-end gap-3">
                        {isSaving ? (
                            <span className="flex items-center gap-1 animate-pulse">
                                <Save size={14} /> Saving
                            </span>
                        ) : (
                            <span>Saved</span>
                        )}
                        <button
                            onClick={() => onDelete(date)}
                            className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50"
                            title="Delete entry"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            </div>

            <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="How was your day?"
                className="w-full resize-none outline-none text-lg text-slate-600 placeholder:text-slate-300 min-h-[150px] bg-transparent leading-relaxed"
            />

            <GeminiPanel
                isLoading={geminiState.loading}
                suggestion={geminiState.suggestion}
                onApplyTool={handleApplyTool}
                onClose={() => setGeminiState({ loading: false, suggestion: null })}
            />
        </div>
    );
};

export default DiaryEntry;
