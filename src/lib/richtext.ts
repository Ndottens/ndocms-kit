import type { RichTextNode } from './types';
import { internalHref } from './href';

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
                // Through internalHref for the same reason as a link in a slice:
                // Cloudflare answers /contact with a 307 to /contact/. A link
                // typed into a text field would otherwise be the one place on the
                // site that still costs a redirect on every click.
                const href = escapeHtml(internalHref(mark.attrs?.href, '#'));
                return `<a href="${href}" class="underline">${acc}</a>`;
            }
            default:
                return acc;
        }
    }, text);
}

// Every node type that carries meaning without text has to be named here, or
// the block below throws it away. Today there is none — the editor only stores
// text, breaks and the blocks that wrap them.
function hasText(node: RichTextNode): boolean {
    if (node.type === 'text') {
        return (node.text ?? '').trim() !== '';
    }
    return (node.content ?? []).some(hasText);
}

function renderNode(node: RichTextNode): string {
    if (node.type === 'text') {
        return renderMarks(escapeHtml(node.text ?? ''), node.marks);
    }
    if (node.type === 'hardBreak') {
        return '<br />';
    }
    // An empty block is a keystroke, not content. TipTap stores the blank line
    // a client leaves behind while typing, and `<p></p>` on the page is a block
    // of no height that still claims its margin — so the gap it opens is
    // neither the blank line the editor showed nor the rhythm the design set.
    // Spacing is CSS; the markup carries only what was written.
    if (!hasText(node)) {
        return '';
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
