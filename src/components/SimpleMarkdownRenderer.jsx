import React from 'react';

const SimpleMarkdownRenderer = ({ content }) => {
    if (!content) return null;

    const processInline = (text) => {
        const parts = String(text).split(/(\*\*.*?\*\*|`.*?`|\*[^*]+?\*)/g);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={index} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={index} className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[0.9em]">{part.slice(1, -1)}</code>;
            }
            if (part.startsWith('*') && part.endsWith('*')) {
                return <em key={index}>{part.slice(1, -1)}</em>;
            }
            return part;
        });
    };

    const lines = content.split('\n');
    const elements = [];
    let blockquotes = [];
    let listItems = [];
    let listType = null;
    let blockKey = 0;

    const flushBlockquotes = () => {
        if (!blockquotes.length) return;
        elements.push(
            <div key={`quote-${blockKey++}`} className="my-4 bg-indigo-50 border-l-4 border-indigo-300 p-4 rounded-r-lg text-indigo-900 italic text-base leading-relaxed">
                {blockquotes.map((line, index) => (
                    <div key={index} className="mb-1 last:mb-0">{processInline(line)}</div>
                ))}
            </div>
        );
        blockquotes = [];
    };

    const flushList = () => {
        if (!listItems.length) return;
        const ListTag = listType === 'ordered' ? 'ol' : 'ul';
        elements.push(
            <ListTag
                key={`list-${blockKey++}`}
                className={`${listType === 'ordered' ? 'list-decimal' : 'list-disc'} ml-6 my-3 space-y-2 text-lg text-slate-700 leading-relaxed`}
            >
                {listItems.map((item, index) => <li key={index}>{processInline(item)}</li>)}
            </ListTag>
        );
        listItems = [];
        listType = null;
    };

    lines.forEach(line => {
        const trimmed = line.trim();
        const quoteMatch = line.match(/^>\s?(.*)$/);
        const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
        const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);

        if (quoteMatch) {
            flushList();
            blockquotes.push(quoteMatch[1]);
            return;
        }

        if (unorderedMatch || orderedMatch) {
            flushBlockquotes();
            const nextType = orderedMatch ? 'ordered' : 'unordered';
            if (listType && listType !== nextType) flushList();
            listType = nextType;
            listItems.push((orderedMatch || unorderedMatch)[1]);
            return;
        }

        flushBlockquotes();
        flushList();

        if (!trimmed) {
            if (elements.length > 0) elements.push(<div key={`spacer-${blockKey++}`} className="h-3" />);
            return;
        }

        if (headingMatch) {
            const level = headingMatch[1].length;
            const heading = headingMatch[2];
            if (level === 1) {
                elements.push(<h1 key={`h-${blockKey++}`} className="text-2xl font-bold text-slate-900 mt-2 mb-4">{processInline(heading)}</h1>);
            } else if (level === 2) {
                elements.push(<h2 key={`h-${blockKey++}`} className="text-xl font-bold text-slate-900 mt-2 mb-3">{processInline(heading)}</h2>);
            } else {
                elements.push(<h3 key={`h-${blockKey++}`} className="text-lg font-semibold text-slate-800 mt-4 mb-2">{processInline(heading)}</h3>);
            }
            return;
        }

        if (/^---+$/.test(trimmed)) {
            elements.push(<hr key={`hr-${blockKey++}`} className="my-5 border-slate-200" />);
            return;
        }

        elements.push(
            <p key={`p-${blockKey++}`} className="mb-2 text-lg text-slate-700 leading-relaxed whitespace-pre-wrap">
                {processInline(line)}
            </p>
        );
    });

    flushBlockquotes();
    flushList();

    return <div className="markdown-content">{elements}</div>;
};

export default SimpleMarkdownRenderer;
