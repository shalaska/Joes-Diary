import React, { useRef, useState } from 'react';
import { Archive, CheckCircle2, FileArchive, LoaderCircle, Upload } from 'lucide-react';
import { parseNotionExport } from '../services/notionExportService';

const NotionSettings = ({ onImport }) => {
    const fileInputRef = useRef(null);
    const [fileName, setFileName] = useState('');
    const [preview, setPreview] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setPreview(null);
        setMessage('');
        setError('');
        setParsing(true);
        try {
            setPreview(await parseNotionExport(file));
        } catch (parseError) {
            setError(parseError.message);
        } finally {
            setParsing(false);
        }
    };

    const handleImport = async () => {
        if (!preview?.entries?.length) return;
        setImporting(true);
        setError('');
        setMessage('');
        try {
            const count = await onImport(preview.entries);
            setMessage(`${count} Notion diary entries imported successfully.`);
        } catch (importError) {
            setError(importError.message || 'The Notion entries could not be imported.');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="space-y-5">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                Import from Notion
            </h3>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                    <Archive size={16} className="text-indigo-600" />
                    Export your diary database
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-xs leading-relaxed">
                    <li>Open the diary database in Notion and choose <strong>••• → Export</strong>.</li>
                    <li>Select <strong>Markdown & CSV</strong> and include subpages.</li>
                    <li>Download the ZIP, then choose it below.</li>
                </ol>
                <p className="text-xs text-slate-500">The ZIP is processed in this browser and is never uploaded as a file.</p>
                <p className="text-xs text-slate-500">Text and Markdown are imported; images and other attachments inside the ZIP are not uploaded.</p>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={handleFile}
                className="hidden"
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing || importing}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 px-4 py-4 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
                {parsing ? <LoaderCircle size={19} className="animate-spin" /> : <FileArchive size={19} />}
                {parsing ? 'Reading export…' : fileName || 'Choose Notion export ZIP'}
            </button>

            {preview && (
                <div className="space-y-4">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 space-y-1">
                        <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                            <CheckCircle2 size={17} />
                            {preview.entries.length} entries ready
                        </p>
                        <p className="text-xs text-emerald-700">
                            {preview.databaseName} · Date field: {preview.dateColumn}
                        </p>
                    </div>

                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                        {preview.entries.slice(0, 5).map(entry => (
                            <div key={entry.date} className="px-3 py-2.5 bg-white">
                                <p className="text-sm font-medium text-slate-800 truncate">{entry.title}</p>
                                <p className="text-xs text-slate-500">{new Date(entry.date).toLocaleDateString()}</p>
                            </div>
                        ))}
                        {preview.entries.length > 5 && (
                            <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50">
                                Plus {preview.entries.length - 5} more entries
                            </p>
                        )}
                    </div>

                    {preview.warnings.length > 0 && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 p-3 rounded-lg">
                            {preview.warnings.length} export item{preview.warnings.length === 1 ? '' : 's'} need attention. Import will continue with everything that could be matched.
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={handleImport}
                        disabled={importing}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
                    >
                        {importing ? <LoaderCircle size={17} className="animate-spin" /> : <Upload size={17} />}
                        {importing ? 'Importing…' : `Import ${preview.entries.length} entries`}
                    </button>

                    <p className="text-xs text-slate-500">
                        Importing a newer export again updates entries with the same dates. Existing entries at other dates are left alone.
                    </p>
                </div>
            )}

            {message && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 p-3 rounded-lg">{message}</p>}
            {error && <p className="text-xs text-red-700 bg-red-50 border border-red-100 p-3 rounded-lg">{error}</p>}
        </div>
    );
};

export default NotionSettings;
