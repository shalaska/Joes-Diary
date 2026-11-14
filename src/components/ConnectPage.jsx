import React, { useEffect, useState } from 'react';
import { Book, Check, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/authContext';
import Auth from './Auth';

// The consent page for outside AI apps (Phase 3): an app such as Claude sends the user here to
// connect to the diary. The sign-in server checks the request (/oauth/authorize/check), the
// user signs in with the app's own login if needed, then allows or denies. Only Claude's
// addresses get this far: the server refuses every other app before this page shows anything.

const postJson = async (path, body) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
};

const Frame = ({ children }) => (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
                    <Book className="text-white" size={22} />
                </div>
                <span className="text-xl font-bold text-slate-900 tracking-tight">JoesDiary</span>
            </div>
            {children}
        </div>
    </div>
);

const goTo = (url) => window.location.assign(url);

export function ConnectConsent({ params, navigate = goTo }) {
    const { currentUser, logout } = useAuth();
    const [check, setCheck] = useState(null);
    const [suggest, setSuggest] = useState(false);
    const [change, setChange] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        postJson('/oauth/authorize/check', { params })
            .then(({ data }) => {
                if (!live) return;
                // Problems with a trusted client and redirect go back to the app as OAuth errors.
                if (data?.redirect) navigate(data.redirect);
                else setCheck(data?.ok ? data : { ok: false, error: data?.error || 'This connection request is not valid.' });
            })
            .catch(() => live && setCheck({ ok: false, error: 'The diary could not check this request. Try again.' }));
        return () => { live = false; };
    }, [params, navigate]);

    if (!check) return <Frame><p className="text-slate-500">Checking the request…</p></Frame>;
    if (!check.ok) {
        return (
            <Frame>
                <h1 className="text-lg font-semibold text-slate-900 mb-2">Cannot connect</h1>
                <p className="text-slate-600">{check.error}</p>
            </Frame>
        );
    }
    if (!currentUser) return <Auth />;

    const answer = async (approved) => {
        setBusy(true);
        setError('');
        try {
            const idToken = await currentUser.getIdToken();
            const { data } = await postJson('/oauth/authorize', { params, idToken, approved, suggest: approved && suggest, change: approved && change });
            if (data?.redirect) {
                navigate(data.redirect);
                return;
            }
            setError(data?.error_description || 'The diary could not finish connecting.');
        } catch {
            setError('The diary could not finish connecting. Try again.');
        }
        setBusy(false);
    };

    return (
        <Frame>
            <h1 className="text-lg font-semibold text-slate-900">Connect {check.client.name} to your diary?</h1>
            <p className="text-sm text-slate-500 mt-1">
                It will send you back to <span className="font-medium text-slate-700">{check.redirectHost}</span>.
            </p>

            <div className="mt-6 space-y-3 text-sm">
                <div className="flex gap-2 text-slate-700">
                    <Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                    <span>Search and read your diary entries and your to-do list, when you ask it something that needs them.</span>
                </div>
                <label className="flex items-start gap-2 text-slate-700 cursor-pointer">
                    <span className="w-[18px] shrink-0 flex justify-center pt-0.5">
                        <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />
                    </span>
                    <span>Also suggest to-dos and notes. Each suggestion waits in the diary until you tap Add.</span>
                </label>
                <label className="flex items-start gap-2 text-slate-700 cursor-pointer">
                    <span className="w-[18px] shrink-0 flex justify-center pt-0.5">
                        <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={change} onChange={(e) => setChange(e.target.checked)} />
                    </span>
                    <span>Also add, tick off and delete to-dos, and save week reviews, without asking. What it adds is marked “by Claude”.</span>
                </label>
                <div className="flex gap-2 text-slate-500">
                    <X size={18} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>It can never edit or delete what you wrote in the diary, see your calendar, or send anything.</span>
                </div>
                <div className="flex gap-2 text-slate-500">
                    <ShieldCheck size={18} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>What it reads goes into your conversation there. The connection ends after 30 days unused, or when you revoke it in Settings.</span>
                </div>
            </div>

            {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mt-6 border border-red-100">{error}</div>}

            <div className="flex gap-3 mt-8">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => answer(false)}
                    className="flex-1 py-3 rounded-xl font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    Deny
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => answer(true)}
                    className="flex-1 py-3 rounded-xl font-medium bg-indigo-600 hover:bg-indigo-700 text-white shadow-md disabled:opacity-50"
                >
                    Allow
                </button>
            </div>
            <p className="text-xs text-slate-400 mt-4 text-center">
                Signed in as {currentUser.email}.{' '}
                <button type="button" className="underline" onClick={() => logout()}>Not you?</button>
            </p>
        </Frame>
    );
}

export default function ConnectPage({ search = window.location.search }) {
    const [params] = useState(() => Object.fromEntries(new URLSearchParams(search)));
    return <ConnectConsent params={params} />;
}
