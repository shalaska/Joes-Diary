import React from 'react';
import { Sparkles, ArrowRight, PlusCircle } from 'lucide-react';

const GeminiPanel = ({ suggestion, isLoading, onApplyTool, onClose }) => {
    if (!suggestion && !isLoading) return null;

    return (
        <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl p-4 animate-fade-in relative">
            <div className="flex items-start gap-3">
                <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
                    <Sparkles size={18} />
                </div>
                <div className="flex-1">
                    {isLoading ? (
                        <div className="flex items-center gap-2 text-indigo-800 font-medium">
                            <span className="animate-pulse">Gemini is thinking...</span>
                        </div>
                    ) : (
                        <>
                            <p className="text-indigo-900 leading-relaxed mb-3">
                                {suggestion.content}
                            </p>

                            {suggestion.tool && (
                                <button
                                    onClick={() => onApplyTool(suggestion.tool)}
                                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <PlusCircle size={16} />
                                    {suggestion.tool.label}
                                </button>
                            )}
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
