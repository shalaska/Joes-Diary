import JSZip from 'jszip';
import Papa from 'papaparse';

const NOTION_ID_SUFFIX = /\s+[0-9a-f]{32}$/i;

function fileBaseName(path) {
    const name = path.split('/').pop() || '';
    return name.replace(/\.(md|csv)$/i, '').replace(NOTION_ID_SUFFIX, '').trim();
}

function normalizeTitle(value) {
    return String(value || '')
        .replace(/^\[(.*)\]\([^)]*\)$/, '$1')
        .replace(NOTION_ID_SUFFIX, '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function parseDateValue(value) {
    if (!value) return null;
    const raw = String(value).trim().split(/\s*(?:→|->)\s*/)[0].replace(/^@/, '');
    const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDay) return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function findDateColumn(fields, rows) {
    const named = fields.find(field => field.trim().toLowerCase() === 'date')
        || fields.find(field => /(^|\s)date($|\s)/i.test(field));
    if (named) return named;

    return fields
        .map(field => {
            const populated = rows.map(row => row[field]).filter(Boolean).slice(0, 50);
            const valid = populated.filter(value => parseDateValue(value)).length;
            return { field, score: populated.length ? valid / populated.length : 0 };
        })
        .filter(candidate => candidate.score >= 0.8)
        .sort((a, b) => b.score - a.score)[0]?.field || null;
}

function findTitleColumn(fields) {
    return fields.find(field => /^(name|title)$/i.test(field.trim())) || fields[0] || null;
}

function findMarkdown(markdownFiles, title, usedPaths) {
    const target = normalizeTitle(title);
    if (!target) return null;

    const exact = markdownFiles.find(file => !usedPaths.has(file.path) && file.normalizedTitle === target);
    if (exact) return exact;

    return markdownFiles.find(file => {
        if (usedPaths.has(file.path)) return false;
        return file.normalizedTitle.startsWith(target) || target.startsWith(file.normalizedTitle);
    }) || null;
}

async function inspectCsv(file) {
    const text = await file.async('string');
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
    const fields = parsed.meta.fields || [];
    const rows = parsed.data || [];
    const dateColumn = findDateColumn(fields, rows);
    const titleColumn = findTitleColumn(fields);
    const datedRows = dateColumn ? rows.filter(row => parseDateValue(row[dateColumn])) : [];

    return {
        path: file.name,
        databaseName: fileBaseName(file.name),
        fields,
        rows,
        dateColumn,
        titleColumn,
        datedRows,
        parseErrors: parsed.errors || []
    };
}

export async function parseNotionExport(file) {
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Choose the ZIP file produced by Notion’s “Markdown & CSV” export.');
    }

    const zipSource = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
    const zip = await JSZip.loadAsync(zipSource);
    const files = Object.values(zip.files).filter(item => !item.dir && !item.name.startsWith('__MACOSX/'));
    const csvFiles = files.filter(item => item.name.toLowerCase().endsWith('.csv'));
    const markdownFiles = files
        .filter(item => item.name.toLowerCase().endsWith('.md'))
        .map(item => ({
            file: item,
            path: item.name,
            normalizedTitle: normalizeTitle(fileBaseName(item.name))
        }));

    if (!csvFiles.length) {
        throw new Error('No database CSV was found. Export the Notion database as “Markdown & CSV” with subpages included.');
    }

    const candidates = await Promise.all(csvFiles.map(inspectCsv));
    const database = candidates
        .filter(candidate => candidate.dateColumn && candidate.titleColumn)
        .sort((a, b) => b.datedRows.length - a.datedRows.length)[0];

    if (!database) {
        throw new Error('I found CSV files, but none had a recognizable Date column.');
    }

    const usedPaths = new Set();
    const entries = [];
    const warnings = [];
    const seenDays = new Set();

    for (const row of database.datedRows) {
        const day = parseDateValue(row[database.dateColumn]);
        const title = String(row[database.titleColumn] || day).trim();
        if (!day) continue;
        if (seenDays.has(day)) {
            warnings.push(`${title}: another entry already uses ${day}`);
            continue;
        }

        const markdown = findMarkdown(markdownFiles, title, usedPaths);
        let content = '';
        if (markdown) {
            usedPaths.add(markdown.path);
            content = (await markdown.file.async('string')).trim();
        } else {
            const propertyLines = database.fields
                .filter(field => field !== database.dateColumn && field !== database.titleColumn && row[field])
                .map(field => `- **${field}:** ${row[field]}`);
            content = propertyLines.length ? `# ${title}\n\n${propertyLines.join('\n')}` : `# ${title}`;
            warnings.push(`${title}: matching Markdown page not found; imported database properties only`);
        }

        if (new Blob([content]).size > 900000) {
            warnings.push(`${title}: skipped because the page is too large for a diary entry`);
            continue;
        }

        const date = `${day}T12:00:00.000Z`;
        entries.push({
            date,
            groupId: new Date(date).toDateString(),
            content,
            title,
            source: 'notion-export',
            notionExportPath: markdown?.path || database.path
        });
        seenDays.add(day);
    }

    if (!entries.length) {
        throw new Error('No dated diary entries could be read from this export.');
    }

    entries.sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
        databaseName: database.databaseName,
        dateColumn: database.dateColumn,
        titleColumn: database.titleColumn,
        entries,
        warnings,
        csvCount: csvFiles.length,
        markdownCount: markdownFiles.length
    };
}
