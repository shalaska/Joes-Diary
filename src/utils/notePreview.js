// A one-line plain-text preview of a day for the sidebar: the latest note, never a saved analysis,
// with Markdown and HTML taken out.
export const plainText = (text) => String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const dayPreview = (entries = []) => {
    const notes = entries.filter(e => e.type !== 'analysis' && plainText(e.content));
    const latest = notes.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return latest ? plainText(latest.content) : '';
};

export const noteCount = (entries = []) => entries.filter(e => e.type !== 'analysis').length;
