import React from 'react';

const SimpleMarkdownRenderer = ({ content }) => {
    if (!content) return null;

    // Helper to process inline formatting (bold)
    const processInline = (text) => {
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={index} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    const lines = content.split('\n');
    const elements = [];
    let currentBlockquote = [];

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('>')) {
            // Remove the '>' and space
            const content = line.replace(/^>\s?/, '');
            currentBlockquote.push(content);
        } else {
            // If we were building a blockquote, push it now
            if (currentBlockquote.length > 0) {
                elements.push(
                    <div key={`quote-${index}`} className="my-4 bg-indigo-50 border-l-4 border-indigo-300 p-4 rounded-r-lg text-indigo-900 italic text-base leading-relaxed">
                        {currentBlockquote.map((quoteLine, i) => (
                            <div key={i} className="mb-1 last:mb-0">
                                {processInline(quoteLine)}
                            </div>
                        ))}
                    </div>
                );
                currentBlockquote = [];
            }

            // Push the current line (if not empty, or as a spacer)
            if (trimmedLine === '') {
                elements.push(<div key={`spacer-${index}`} className="h-4" />);
            } else {
                elements.push(
                    <p key={`p-${index}`} className="mb-2 text-lg text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {processInline(line)}
                    </p>
                );
            }
        }
    });

    // Flush remaining blockquote
    if (currentBlockquote.length > 0) {
        elements.push(
            <div key="quote-end" className="my-4 bg-indigo-50 border-l-4 border-indigo-300 p-4 rounded-r-lg text-indigo-900 italic text-base leading-relaxed">
                {currentBlockquote.map((quoteLine, i) => (
                    <div key={i} className="mb-1 last:mb-0">
                        {processInline(quoteLine)}
                    </div>
                ))}
            </div>
        );
    }

    return <div className="markdown-content">{elements}</div>;
};

export default SimpleMarkdownRenderer;
