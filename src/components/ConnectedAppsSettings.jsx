import React, { useEffect, useState } from 'react';
import { Check, Copy, Plug, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/authContext';
import ClaudeTrash from './ClaudeTrash';

// "Connected apps" (Phase 3): outside AI apps the user has let read the diary, such as Claude,
// with Revoke. The list and revoke go to the diary's sign-in server, which keeps connections
// where no browser can read them.

export const CONNECTOR_URL = 'https://joesdiary-d8211.web.app/mcp';

const SCOPE_LABELS = { 'diary.read': 'Read', 'diary.suggest': 'Suggest', 'diary.change': 'Change to-dos' };

const formatDay = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const postJson = async (path, body) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error_description || data?.error || 'Request failed');
    return data;
};

const ConnectedAppsSettings = ({ onRestoreTodo }) => {
    const currentUser = useAuth()?.currentUser;
    const [connections, setConnections] = useState(null);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!currentUser) return undefined;
        let live = true;
        currentUser.getIdToken()
            .then(idToken => postJson('/oauth/connections', { idToken }))
            .then(data => live && setConnections(data.connections || []))
            .catch(() => live && setError('Could not load connected apps.'));
        return () => { live = false; };
    }, [currentUser]);

    const revoke = async (id) => {
        setBusyId(id);
        try {
            await postJson('/oauth/connections/revoke', { idToken: await currentUser.getIdToken(), id });
            setConnections((list) => (list || []).filter(c => c.id !== id));
        } catch {
            setError('Could not revoke. Try again.');
        }
        setBusyId('');
    };

    const copyUrl = async () => {
        await navigator.clipboard.writeText(CONNECTOR_URL);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-5">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                Connected apps
            </h3>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                    <Plug size={17} className="text-indigo-600" />
                    Use your diary from Claude
                </p>
                <p className="text-xs leading-relaxed">
                    In Claude, add a custom connector with the address below, then log in here when Claude asks.
                    Claude can read your diary and to-dos when you ask it something, and only suggest changes if you allow it.
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        readOnly
                        value={CONNECTOR_URL}
                        aria-label="Connector address"
                        className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-600"
                    />
                    <button
                        type="button"
                        onClick={copyUrl}
                        className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {connections === null && !error && <p className="text-sm text-slate-500">Loading connected apps…</p>}
            {connections?.length === 0 && <p className="text-sm text-slate-500">No apps are connected.</p>}

            {connections?.length > 0 && (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {connections.map((c) => (
                        <li key={c.id} className="flex items-center gap-3 p-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-800 truncate">{c.clientName}</p>
                                <p className="text-xs text-slate-500">
                                    {(c.scopes || []).map(s => SCOPE_LABELS[s] || s).join(' + ')} · via {c.redirectHost} · last used {formatDay(c.lastUsedAt)}
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={busyId === c.id}
                                onClick={() => revoke(c.id)}
                                className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                                <Trash2 size={14} />
                                Revoke
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <ClaudeTrash uid={currentUser?.uid} onRestored={onRestoreTodo} />
        </div>
    );
};

export default ConnectedAppsSettings;
