import React, { useState, useEffect, useRef } from 'react';
import { Save, Sparkles, Trash2 } from 'lucide-react';
import { askGemini, editSelection } from '../services/geminiService';
import GeminiPanel from './GeminiPanel';
import FloatingGeminiMenu from './FloatingGeminiMenu';

const DiaryEntry = ({ date, initialContent, onSave, onDelete, showDateHeader = true }) => {
    const [content, setContent] = useState(initialContent || '');
    const [isSaving, setIsSaving] = useState(false);
    const [geminiState, setGeminiState] = useState({ loading: false, suggestion: null });
    const [chatHistory, setChatHistory] = useState([]);
    const textareaRef = useRef(null);

    const [menuPosition, setMenuPosition] = useState(null);
    const [selectedText, setSelectedText] = useState('');
    const [selectionRange, setSelectionRange] = useState(null);
    const [isMenuLoading, setIsMenuLoading] = useState(false);

    const containerRef = useRef(null);

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

    const checkSelection = (clientY) => {
        const textarea = textareaRef.current;
        const container = containerRef.current;
        if (!textarea || !container) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        if (start !== end) {
            const text = textarea.value.substring(start, end);
            setSelectedText(text);
            setSelectionRange({ start, end });

            // Calculate position relative to the container
            const containerRect = container.getBoundingClientRect();

            // Position to the right of the container
            // Top aligned with the click position relative to the container
            // If clientY is not provided (keyboard selection), default to a reasonable position (e.g., top of textarea)
            const relativeTop = clientY
                ? clientY - containerRect.top
                : textarea.offsetTop + 20;

            setMenuPosition({
                top: relativeTop,
                left: '100%', // Position outside to the right
                marginLeft: '16px' // Add some spacing
            });
        } else {
            setMenuPosition(null);
        }
    };

    useEffect(() => {
        const handleGlobalMouseUp = (e) => {
            // Check if we are interacting with the menu itself, if so don't clear selection
            if (e.target.closest('.floating-gemini-menu')) return;
            checkSelection(e.clientY);
        };

        const handleKeyUp = (e) => {
            if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
                checkSelection(null);
            }
        };

        document.addEventListener('mouseup', handleGlobalMouseUp);
        // We attach keyup to the textarea specifically via prop, but global is okay too if we check focus.
        // Actually, let's keep keyup on the textarea element for better scoping.

        return () => {
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, []);

    const handleAskGemini = async () => {
        setGeminiState({ loading: true, suggestion: null });
        setChatHistory([]); // Reset history on new "Ask Gemini"
        try {
            const suggestion = await askGemini(content);
            setGeminiState({ loading: false, suggestion });
            setChatHistory([{ role: 'model', content: suggestion.content }]);
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

    const handleGeminiReply = async (replyText) => {
        setGeminiState(prev => ({ ...prev, loading: true }));
        const newHistory = [...chatHistory, { role: 'user', content: replyText }];
        setChatHistory(newHistory);

        try {
            const suggestion = await askGemini(replyText, newHistory);
            setGeminiState({ loading: false, suggestion });
            setChatHistory(prev => [...prev, { role: 'model', content: suggestion.content }]);
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            setGeminiState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleMenuAction = async (instruction) => {
        setIsMenuLoading(true);
        try {
            const result = await editSelection(selectedText, instruction);

            if (result.startsWith("[ANSWER]:")) {
                // If it's an answer, show it in the main Gemini panel or alert? 
                // Let's use the GeminiPanel for consistency if possible, or just replace if the user asked to "replace"
                // But the prompt says "answer the question". 
                // Let's just alert for now or maybe open the GeminiPanel with the answer?
                // Actually, opening the GeminiPanel is better.
                setGeminiState({
                    loading: false,
                    suggestion: {
                        type: 'suggestion',
                        content: result.replace("[ANSWER]: ", "")
                    }
                });
                setMenuPosition(null); // Close floating menu
            } else {
                // It's an edit, replace the text
                const newContent = content.substring(0, selectionRange.start) + result + content.substring(selectionRange.end);
                setContent(newContent);
                setMenuPosition(null);
            }
        } catch (error) {
            console.error("Error editing selection:", error);
        } finally {
            setIsMenuLoading(false);
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
        <div ref={containerRef} className="w-full max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mb-6 transition-all hover:shadow-md group relative">
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
                onKeyUp={(e) => {
                    if (e.shiftKey && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) {
                        checkSelection(null);
                    }
                }}
                placeholder="How was your day?"
                className="w-full resize-none outline-none text-lg text-slate-600 placeholder:text-slate-300 min-h-[150px] bg-transparent leading-relaxed"
            />

            <FloatingGeminiMenu
                position={menuPosition}
                onAsk={handleMenuAction}
                onClose={() => setMenuPosition(null)}
                isLoading={isMenuLoading}
                selectedText={selectedText}
            />

            <GeminiPanel
                isLoading={geminiState.loading}
                suggestion={geminiState.suggestion}
                onApplyTool={handleApplyTool}
                onClose={() => setGeminiState({ loading: false, suggestion: null })}
                onReply={handleGeminiReply}
            />
        </div>
    );
};

export default DiaryEntry;
