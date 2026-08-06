import React, { useState } from 'react';
import { Download, FileArchive, LoaderCircle } from 'lucide-react';
import { downloadDiaryExport } from '../services/diaryExportService';

const DataExportSettings = ({ entries, dayMetadata }) => {
    const [exporting, setExporting] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const noteCount = entries.filter(entry => entry.content?.trim()).length;

    const handleExport = async () => {
        setExporting(true);
        setMessage('');
        setError('');
        try {
            await downloadDiaryExport(entries, dayMetadata);
            setMessage(`${noteCount} notes exported successfully.`);
        } catch (exportError) {
            setError(exportError.message || 'The notes could not be exported.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-5">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                Export Notes
            </h3>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm text-slate-700 flex items-start gap-3">
                <FileArchive size={19} className="text-indigo-600 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-semibold text-slate-800">Download a complete notes backup</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Creates a ZIP with {noteCount} Markdown note{noteCount === 1 ? '' : 's'} and a CSV index of titles and dates.
                    </p>
                </div>
            </div>

            <button
                type="button"
                onClick={handleExport}
                disabled={exporting || noteCount === 0}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
            >
                {exporting ? <LoaderCircle size={17} className="animate-spin" /> : <Download size={17} />}
                {exporting ? 'Preparing export…' : `Export ${noteCount} notes`}
            </button>

            {message && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 p-3 rounded-lg">{message}</p>}
            {error && <p className="text-xs text-red-700 bg-red-50 border border-red-100 p-3 rounded-lg">{error}</p>}
        </div>
    );
};

export default DataExportSettings;
