import React, { useState, useEffect } from 'react';
import { X, Save, Key, MessageSquare } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, onSave, initialApiKey, initialSystemPrompt, initialEditPrompt }) => {
    const [apiKey, setApiKey] = useState(initialApiKey || '');
    const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt || '');
    const [editPrompt, setEditPrompt] = useState(initialEditPrompt || '');

    useEffect(() => {
        if (isOpen) {
            setApiKey(initialApiKey || '');
            setSystemPrompt(initialSystemPrompt || '');
            setEditPrompt(initialEditPrompt || '');
        }
    }, [isOpen, initialApiKey, initialSystemPrompt, initialEditPrompt]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(apiKey, systemPrompt, editPrompt);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 sticky top-0 z-10">
                    <h2 className="text-xl font-bold text-slate-800">Settings</h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-200"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">

                    {/* API Key Section */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <Key size={16} className="text-indigo-600" />
                            Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Enter your Gemini API Key"
                            className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 font-mono text-sm"
                        />
                        <p className="text-xs text-slate-500">
                            Your key is stored locally in your browser.
                        </p>
                    </div>

                    {/* System Prompt Section */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <MessageSquare size={16} className="text-indigo-600" />
                            System Prompt
                        </label>
                        <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            placeholder="Define how Gemini should behave..."
                            rows={6}
                            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 text-sm resize-none leading-relaxed"
                        />
                        <p className="text-xs text-slate-500">
                            Customize Gemini's personality and instructions.
                        </p>
                    </div>

                    {/* Edit Prompt Section */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <MessageSquare size={16} className="text-indigo-600" />
                            Edit Prompt
                        </label>
                        <textarea
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            placeholder="Define how Gemini should edit text..."
                            rows={6}
                            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 text-sm resize-none leading-relaxed"
                        />
                        <p className="text-xs text-slate-500">
                            Template for text editing. Use <code>{`{{selection}}`}</code> and <code>{`{{instruction}}`}</code> placeholders.
                        </p>
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end sticky bottom-0 z-10">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-sm hover:shadow-md active:scale-95"
                    >
                        <Save size={18} />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
