import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { loadClaudeTrash, restoreClaudeTrash } from '../services/claudeTrash';

const ClaudeTrash = ({ uid, onRestored = () => {} }) => {
    const [items, setItems] = useState([]);
    const [busyId, setBusyId] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!uid) return undefined;
        let live = true;
        loadClaudeTrash(uid).then(list => live && setItems(list)).catch(() => {});
        return () => { live = false; };
    }, [uid]);

    if (items.length === 0) return null;

    const restore = async (item) => {
        setBusyId(item.id);
        try {
            const todo = await restoreClaudeTrash(uid, item);
            setItems(list => list.filter(t => t.id !== item.id));
            onRestored(todo);
        } catch {
            setError('Could not restore. Try again.');
        }
        setBusyId('');
    };

    return (
        <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Deleted by Claude</p>
            <p className="text-xs text-slate-500">You can bring these back for 7 days after Claude deleted them.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {items.map(item => (
                    <li key={item.id} className="flex items-center gap-3 p-3">
                        <span className="min-w-0 flex-1 text-sm text-slate-700 truncate">{item.todo?.text}</span>
                        <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => restore(item)}
                            className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RotateCcw size={14} />
                            Restore
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ClaudeTrash;
