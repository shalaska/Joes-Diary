import JSZip from 'jszip';
import Papa from 'papaparse';

function safeFileName(value) {
    return String(value || 'Untitled')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Untitled';
}

function entryDetails(entry, dayMetadata) {
    const parsedDate = new Date(entry.date);
    const groupId = entry.groupId || parsedDate.toDateString();
    const title = dayMetadata[groupId]?.customTitle
        || parsedDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const day = parsedDate.toISOString().slice(0, 10);
    const time = parsedDate.toISOString().slice(11, 19).replace(/:/g, '-');
    return { parsedDate, groupId, title, day, time };
}

export async function createDiaryExport(entries, dayMetadata = {}, outputType = 'blob') {
    const notes = entries
        .filter(entry => entry.content?.trim())
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!notes.length) {
        throw new Error('There are no non-empty notes to export.');
    }

    const zip = new JSZip();
    const notesFolder = zip.folder('notes');
    const manifest = [];
    const usedNames = new Set();

    notes.forEach(entry => {
        const details = entryDetails(entry, dayMetadata);
        const baseName = `${details.day} ${safeFileName(details.title)} ${details.time}`;
        let fileName = `${baseName}.md`;
        let suffix = 2;
        while (usedNames.has(fileName.toLowerCase())) {
            fileName = `${baseName} ${suffix}.md`;
            suffix++;
        }
        usedNames.add(fileName.toLowerCase());
        notesFolder.file(fileName, entry.content);

        manifest.push({
            Title: details.title,
            Date: details.day,
            Time: details.parsedDate.toISOString().slice(11, 19),
            File: `notes/${fileName}`,
            Source: entry.source || 'joes-diary'
        });
    });

    zip.file('notes.csv', Papa.unparse(manifest));
    zip.file('README.txt', [
        'JoesDiary notes export',
        '',
        `${notes.length} notes exported on ${new Date().toISOString()}.`,
        'Each note is stored as Markdown in the notes folder.',
        'notes.csv contains the title, date, time, filename, and source for every note.'
    ].join('\n'));

    return zip.generateAsync({ type: outputType });
}

export async function downloadDiaryExport(entries, dayMetadata = {}) {
    const blob = await createDiaryExport(entries, dayMetadata, 'blob');
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `joes-diary-notes-${date}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
