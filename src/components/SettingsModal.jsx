import React, { useState } from 'react';
import { X, Save, ShieldCheck, MessageSquare, Calendar, Key } from 'lucide-react';
import NotionSettings from './NotionSettings';
import DataExportSettings from './DataExportSettings';
import SiriShortcutSettings from './SiriShortcutSettings';
import ConnectedAppsSettings from './ConnectedAppsSettings';
import WritingReminderSettings from './WritingReminderSettings';

const SettingsModal = ({
    onClose,
    onSave,
    initialSystemPrompt,
    initialEditPrompt,
    initialGoogleClientId,
    initialGoogleApiKey,
    initialIcsProxyUrl,
    onNotionImport,
    entries,
    dayMetadata,
    onRestoreTodo,
}) => {
    const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt || '');
    const [editPrompt, setEditPrompt] = useState(initialEditPrompt || '');
    const [googleClientId, setGoogleClientId] = useState(initialGoogleClientId || '');
    const [googleApiKey, setGoogleApiKey] = useState(initialGoogleApiKey || '');
    const [icsProxyUrl, setIcsProxyUrl] = useState(initialIcsProxyUrl || '');

    const handleSave = () => {
        onSave(systemPrompt, editPrompt, googleClientId, googleApiKey, icsProxyUrl);
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
                <div className="p-6 space-y-8">

                    {/* Gemini Section */}
                    <div className="space-y-6">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">Gemini Configuration</h3>

                        {/* Gateway notice (the key no longer lives in the browser) */}
                        <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600">
                            <ShieldCheck size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                            <p>
                                AI features run through your private gateway. The Gemini key is stored server-side,
                                the model version is pinned, and only metadata (feature, model, latency, tokens) is logged.
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
                                rows={4}
                                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 text-sm resize-none leading-relaxed"
                            />
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
                                rows={4}
                                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 text-sm resize-none leading-relaxed"
                            />
                            <p className="text-xs text-slate-500">
                                Template for text editing. Use <code>{`{{selection}}`}</code> and <code>{`{{instruction}}`}</code> placeholders.
                            </p>
                        </div>
                    </div>

                    {/* Google Calendar Section */}
                    <div className="space-y-6">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">Google Calendar Integration</h3>

                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
                            You need a Google Cloud Project with the <strong>Google Calendar API</strong> enabled.
                        </div>

                        {/* Client ID */}
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <Calendar size={16} className="text-indigo-600" />
                                Google Client ID
                            </label>
                            <input
                                type="text"
                                value={googleClientId}
                                onChange={(e) => setGoogleClientId(e.target.value)}
                                placeholder="Enter your Google Client ID"
                                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 font-mono text-sm"
                            />
                        </div>

                        {/* API Key */}
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <Key size={16} className="text-indigo-600" />
                                Google API Key
                            </label>
                            <input
                                type="password"
                                value={googleApiKey}
                                onChange={(e) => setGoogleApiKey(e.target.value)}
                                placeholder="Enter your Google API Key"
                                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 font-mono text-sm"
                            />
                        </div>
                    </div>

                    {/* Outlook ICS Section */}
                    <div className="space-y-6">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">Outlook Work Calendar</h3>

                        <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100 text-sm text-emerald-800">
                            The Cloudflare proxy keeps the private Outlook feed address out of the browser and refreshes it automatically.
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <Calendar size={16} className="text-emerald-600" />
                                Work calendar proxy URL
                            </label>
                            <input
                                type="url"
                                value={icsProxyUrl}
                                onChange={(e) => setIcsProxyUrl(e.target.value)}
                                placeholder="https://joes-diary-ics-proxy.…workers.dev/calendar.ics"
                                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-slate-800 font-mono text-sm"
                            />
                            <p className="text-xs text-slate-500">
                                Store only the Worker URL here—not the private Outlook ICS address.
                            </p>
                        </div>
                    </div>

                    <NotionSettings onImport={onNotionImport} />

                    <DataExportSettings entries={entries} dayMetadata={dayMetadata} />

                    <SiriShortcutSettings />

                    <WritingReminderSettings />

                    <ConnectedAppsSettings onRestoreTodo={onRestoreTodo} />

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
