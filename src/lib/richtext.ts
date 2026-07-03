import type { RichTextNode } from './types';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderMarks(text: string, marks?: RichTextNode['marks']): string {
    if (!marks || marks.length === 0) {
        return text;
    }
    return marks.reduce((acc, mark) => {
        switch (mark.type) {
            case 'bold':
                return `<strong>${acc}</strong>`;
            case 'italic':
                return `<em>${acc}</em>`;
            case 'strike':
                return `<s>${acc}</s>`;
            case 'link': {
                const href = escapeHtml(String(mark.attrs?.href ?? '#'));
                return `<a href="${href}" class="underline">${acc}</a>`;
            }
            default:
                return acc;
        }
    }, text);
}

function renderNode(node: RichTextNode): string {
    if (node.type === 'text') {
        return renderMarks(escapeHtml(node.text ?? ''), node.marks);
    }
    if (node.type === 'hardBreak') {
        return '<br />';
    }

    const inner = (node.content ?? []).map(renderNode).join('');

    switch (node.type) {
        case 'paragraph':
            return `<p>${inner}</p>`;
        case 'heading': {
            const level = Number(node.attrs?.level ?? 2);
            return `<h${level}>${inner}</h${level}>`;
        }
        case 'bulletList':
            return `<ul>${inner}</ul>`;
        case 'orderedList':
            return `<ol>${inner}</ol>`;
        case 'listItem':
            return `<li>${inner}</li>`;
        case 'blockquote':
            return `<blockquote>${inner}</blockquote>`;
        default:
            return inner;
    }
}

// Zet de structured-text-array (zoals het rich_text-veld opslaat) om naar HTML.
export function renderRichText(value: unknown): string {
    if (!Array.isArray(value)) {
        return '';
    }
    return (value as RichTextNode[]).map(renderNode).join('');
}
