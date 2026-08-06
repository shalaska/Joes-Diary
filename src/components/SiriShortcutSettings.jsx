import React, { useState } from 'react';
import { Check, Copy, Mic } from 'lucide-react';

const QUICK_CAPTURE_URL = 'https://joesdiary-d8211.web.app/#quickTodo=';

const SiriShortcutSettings = () => {
    const [copied, setCopied] = useState(false);

    const copyUrl = async () => {
        await navigator.clipboard.writeText(QUICK_CAPTURE_URL);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-5">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                Siri Quick Capture
            </h3>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                    <Mic size={17} className="text-indigo-600" />
                    Say “Add to JoesDiary”
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-xs leading-relaxed">
                    <li>In the Shortcuts app, create a new shortcut named <strong>Add to JoesDiary</strong>.</li>
                    <li>Add <strong>Dictate Text</strong>, followed by <strong>URL Encode</strong>.</li>
                    <li>Add a <strong>URL</strong> action, paste the address below, then insert the encoded text after the equals sign.</li>
                    <li>Add <strong>Open URLs</strong>, save, and run it by name with Siri.</li>
                </ol>
            </div>

            <div className="flex gap-2">
                <input
                    type="text"
                    readOnly
                    value={QUICK_CAPTURE_URL}
                    className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-600"
                />
                <button
                    type="button"
                    onClick={copyUrl}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors text-sm"
                >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>

            <p className="text-xs text-slate-500">
                If you are signed out, JoesDiary waits until you sign in before saving the todo. The dictated text is kept in the private URL fragment and removed after capture.
            </p>
        </div>
    );
};

export default SiriShortcutSettings;
