// Browser-side bridge for the NdoCMS story editor. Loaded only on the
// /_ndocms/render shell (via PreviewBridge.astro), never on production pages.
//
// The editor embeds the shell in an iframe and talks postMessage; the bridge
// POSTs draft data to its own origin, swaps the <body> with the rendered
// result, reports DOM events (clicks/hovers on sections) back to the editor,
// draws the selection/hover highlights and the structure overlay (insert
// buttons between sections, move/remove toolbar). The message protocol is
// mirrored in the CMS (resources/js/lib/previewProtocol.ts).

const PROTOCOL_VERSION = 1;

const SELECTED_OUTLINE = '2px solid #6366f1';
const HOVER_OUTLINE = '2px dashed rgba(99, 102, 241, 0.65)';
// Same indigo family as selection/hover, so edit mode reads as one system.
const EDITING_OUTLINE = '2px solid #6366f1';

// Stega marker (mirrors app/Support/PreviewStega.php): invisible prefix
// followed by a base-4 sequence of zero-width characters that encodes
// "<sliceId>|<fieldPath>" inside the rendered text itself.
const STEGA_PREFIX = '\u2063\u2062';
const STEGA_ALPHABET = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
const STEGA_STRIP_RE = /[\u200B\u200C\u200D\uFEFF\u2062\u2063]/g;

function decodeStega(text: string): { sliceId: string; path: string } | null {
    const start = text.indexOf(STEGA_PREFIX);
    if (start === -1) return null;

    let byte = 0;
    let bits = 0;
    const bytes: number[] = [];
    for (const char of text.slice(start + STEGA_PREFIX.length)) {
        const index = STEGA_ALPHABET.indexOf(char);
        if (index === -1) break;
        byte = (byte << 2) | index;
        bits += 2;
        if (bits === 8) {
            bytes.push(byte);
            byte = 0;
            bits = 0;
        }
    }

    const payload = String.fromCharCode(...bytes);
    const separator = payload.indexOf('|');
    if (separator === -1) return null;
    return { sliceId: payload.slice(0, separator), path: payload.slice(separator + 1) };
}

function stripStega(text: string): string {
    return text.replace(STEGA_STRIP_RE, '');
}

// Inline markup inside rich-text blocks comes exclusively from the kit's own
// renderer (renderMarks in richtext.ts), so it can be serialized back to
// structured nodes losslessly. execCommand additions (b/i/strike) are
// normalized through the same table.
const INLINE_MARK_TAGS: Record<string, string> = {
    STRONG: 'bold',
    B: 'bold',
    EM: 'italic',
    I: 'italic',
    S: 'strike',
    DEL: 'strike',
    STRIKE: 'strike',
};

interface RichNode {
    type: string;
    text?: string;
    marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function serializeInline(el: Element, inherited: RichNode['marks'] = []): RichNode[] {
    const out: RichNode[] = [];
    for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = stripStega(child.nodeValue ?? '');
            if (text !== '') {
                out.push({ type: 'text', text, ...(inherited && inherited.length > 0 ? { marks: inherited.map((m) => ({ ...m })) } : {}) });
            }
            continue;
        }
        if (!(child instanceof Element)) continue;
        let marks = inherited ?? [];
        const markType = INLINE_MARK_TAGS[child.tagName];
        if (markType) {
            marks = [...marks.filter((m) => m.type !== markType), { type: markType }];
        } else if (child.tagName === 'A') {
            marks = [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: child.getAttribute('href') ?? '#' } }];
        }
        out.push(...serializeInline(child, marks));
    }
    // Merge adjacent nodes with identical marks, so repeated toggling never
    // fragments the stored structure.
    const merged: RichNode[] = [];
    for (const node of out) {
        const prev = merged[merged.length - 1];
        if (prev && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
            prev.text = (prev.text ?? '') + (node.text ?? '');
        } else {
            merged.push(node);
        }
    }
    return merged;
}

// A rich-text BLOCK (paragraph, list item, heading) contains only text and
// inline mark elements; its parent does not. That block is the single
// editing surface for the whole paragraph.
function isInlineOnly(el: Element): boolean {
    return Array.from(el.childNodes).every(
        (node) =>
            node.nodeType === Node.TEXT_NODE ||
            (node instanceof Element &&
                (node.tagName in INLINE_MARK_TAGS || node.tagName === 'A' || node.tagName === 'SPAN' || node.tagName === 'BR')),
    );
}

function markersIn(root: Element): { sliceId: string; path: string }[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: { sliceId: string; path: string }[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.nodeValue ?? '').includes(STEGA_PREFIX)) {
            const decoded = decodeStega(node.nodeValue ?? '');
            if (decoded) found.push(decoded);
        }
    }
    return found;
}

const BUTTON_BASE =
    'display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'background:#ffffff;border:1px solid #d1d5db;border-radius:9999px;color:#4b5563;' +
    'cursor:pointer;font:500 14px/1 system-ui,sans-serif;padding:0;' +
    'box-shadow:0 1px 2px rgba(0,0,0,0.1);';

interface RenderMessage {
    type: 'ndocms:render';
    requestId: number;
    data: { slices?: unknown[] } & Record<string, unknown>;
    token: string | null;
}

interface SelectMessage {
    type: 'ndocms:select';
    sliceId: string | null;
}

interface HoverMessage {
    type: 'ndocms:hover';
    sliceId: string | null;
}

type InlineMarkType = 'bold' | 'italic' | 'strike' | 'link';

interface EditConfigMessage {
    type: 'ndocms:edit-config';
    marks: InlineMarkType[];
    canClear: boolean;
}

type EditorMessage = RenderMessage | SelectMessage | HoverMessage | EditConfigMessage;

const TRASH_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

const LINK_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

interface BridgeConfig {
    editorOrigin: string;
}

export function initPreviewBridge(): void {
    const configElement = document.getElementById('ndocms-bridge-config');
    if (!configElement?.textContent) return;

    let config: BridgeConfig;
    try {
        config = JSON.parse(configElement.textContent);
    } catch {
        return;
    }

    const editorOrigin = config.editorOrigin;
    if (!editorOrigin || window.parent === window) return;

    // Plain mode (?mode=plain): render-only, no edit chrome. Used for the
    // live slice previews in the add-section modal.
    const plainMode = new URLSearchParams(window.location.search).get('mode') === 'plain';

    let renderAbort: AbortController | null = null;
    let selectedId: string | null = null;
    let hoveredId: string | null = null;
    let lastReportedHoverId: string | null = null;
    let scriptRunCounter = 0;
    let editingElement: HTMLElement | null = null;
    // Lives directly on <html>, NOT inside the overlay: rebuildOverlay()
    // replaceChildren()s the overlay on every select/hover echo and would
    // wipe the toolbar the moment an edit session starts.
    let editToolbar: HTMLElement | null = null;
    // Fills the toolbar once the editor answers inline-edit-start with the
    // field's allowed marks (edit-config message).
    let editToolbarFill: ((config: EditConfigMessage) => void) | null = null;

    // The overlay lives on <html>, not <body>: the body is replaced on every
    // render and the overlay must survive the swap. Children are positioned
    // in document coordinates, so scrolling never invalidates them.
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:0;z-index:2147483000;';
    let resizeObserver: ResizeObserver | null = null;
    if (!plainMode) {
        document.documentElement.appendChild(overlay);
        resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => rebuildOverlay());
        resizeObserver?.observe(document.body);
    }

    function send(message: Record<string, unknown>): void {
        window.parent.postMessage(message, editorOrigin);
    }

    function sliceWrappers(): HTMLElement[] {
        return Array.from(document.querySelectorAll<HTMLElement>('[data-ndocms-slice]'));
    }

    function renderedSliceIds(): string[] {
        return sliceWrappers()
            .map((el) => el.getAttribute('data-ndocms-slice'))
            .filter((id): id is string => Boolean(id));
    }

    function applyHighlights(): void {
        for (const el of sliceWrappers()) {
            const id = el.getAttribute('data-ndocms-slice');
            if (id === selectedId) {
                el.style.outline = SELECTED_OUTLINE;
                el.style.outlineOffset = '-2px';
            } else if (id === hoveredId) {
                el.style.outline = HOVER_OUTLINE;
                el.style.outlineOffset = '-2px';
            } else {
                el.style.outline = '';
                el.style.outlineOffset = '';
            }
        }
    }

    function overlayButton(symbol: string, title: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = symbol;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.style.cssText = `${BUTTON_BASE}width:26px;height:26px;`;
        button.addEventListener('mouseenter', () => {
            button.style.borderColor = '#6366f1';
            button.style.color = '#4f46e5';
        });
        button.addEventListener('mouseleave', () => {
            button.style.borderColor = '#d1d5db';
            button.style.color = '#4b5563';
        });
        button.addEventListener('click', onClick);
        return button;
    }

    function rebuildOverlay(): void {
        if (plainMode) return;
        overlay.replaceChildren();
        const wrappers = sliceWrappers();
        if (wrappers.length === 0) return;

        // Insert buttons on every boundary: before each section + after the last.
        const boundaries: { y: number; beforeSliceId: string | null }[] = wrappers.map((el) => ({
            y: el.getBoundingClientRect().top + window.scrollY,
            beforeSliceId: el.getAttribute('data-ndocms-slice'),
        }));
        boundaries.push({
            y: wrappers[wrappers.length - 1].getBoundingClientRect().bottom + window.scrollY,
            beforeSliceId: null,
        });

        // Clamp so the outermost buttons stay fully visible instead of being
        // cut in half on the document's top and bottom edges.
        const clampMargin = 15;
        const maxTop = document.documentElement.scrollHeight - clampMargin;
        for (const boundary of boundaries) {
            const button = overlayButton('+', 'Sectie toevoegen', () =>
                send({ type: 'ndocms:insert-at', beforeSliceId: boundary.beforeSliceId }),
            );
            button.style.position = 'absolute';
            button.style.left = '50%';
            button.style.top = `${Math.min(Math.max(boundary.y, clampMargin), maxTop)}px`;
            button.style.transform = 'translate(-50%, -50%)';
            overlay.appendChild(button);
        }

        // Move/remove toolbar on the SELECTED section only. Hover would be
        // fluid, but the toolbar then jumps to whichever section the pointer
        // crosses on its way to the buttons — clicks land on the wrong slice.
        const activeId = selectedId;
        const active = wrappers.find((el) => el.getAttribute('data-ndocms-slice') === activeId);
        if (!active || !activeId) return;

        const rect = active.getBoundingClientRect();
        const toolbar = document.createElement('div');
        toolbar.style.cssText =
            `position:absolute;top:${rect.top + window.scrollY + 10}px;right:14px;` +
            'display:flex;gap:4px;padding:3px;background:#ffffff;border:1px solid #d1d5db;' +
            'border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.15);';
        toolbar.appendChild(overlayButton('↑', 'Omhoog', () => send({ type: 'ndocms:move', sliceId: activeId, direction: 'up' })));
        toolbar.appendChild(overlayButton('↓', 'Omlaag', () => send({ type: 'ndocms:move', sliceId: activeId, direction: 'down' })));
        toolbar.appendChild(overlayButton('✕', 'Verwijderen', () => send({ type: 'ndocms:remove', sliceId: activeId })));
        overlay.appendChild(toolbar);
    }

    function setHovered(id: string | null): void {
        if (id === hoveredId) return;
        hoveredId = id;
        applyHighlights();
        rebuildOverlay();
    }

    function scrollToSlice(id: string): void {
        const el = sliceWrappers().find((wrapper) => wrapper.getAttribute('data-ndocms-slice') === id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const mostlyVisible = rect.top >= 0 && rect.top <= window.innerHeight * 0.6;
        if (!mostlyVisible) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function closestSliceId(target: EventTarget | null): string | null {
        if (!(target instanceof Element)) return null;
        return target.closest('[data-ndocms-slice]')?.getAttribute('data-ndocms-slice') ?? null;
    }

    // The exact text node (and caret offset) under the double-click, when it
    // carries a marker. This targets one annotated value even when it shares
    // its parent with other children (decorative spans, <strong> siblings).
    function markedTextNodeAt(x: number, y: number): { node: Text; offset: number } | null {
        const doc = document as Document & {
            caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        let node: Node | null = null;
        let offset = 0;
        if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(x, y);
            node = range?.startContainer ?? null;
            offset = range?.startOffset ?? 0;
        } else if (typeof doc.caretPositionFromPoint === 'function') {
            const position = doc.caretPositionFromPoint(x, y);
            node = position?.offsetNode ?? null;
            offset = position?.offset ?? 0;
        }
        return node instanceof Text && (node.nodeValue ?? '').includes(STEGA_PREFIX) ? { node, offset } : null;
    }

    const RICH_TEXT_PATH_RE = /\.content\.\d+\.text$/;

    // The whole block around a rich-text text node, when every marker inside
    // it belongs to the same content array. Editing then covers the full
    // paragraph with formatting intact instead of one split segment.
    function richBlockFor(textNode: Text, decodedPath: string): { block: HTMLElement; contentPath: string } | null {
        let block = textNode.parentElement;
        if (!block) return null;
        while (
            block.parentElement &&
            block.parentElement !== document.body &&
            !block.hasAttribute('data-ndocms-slice') &&
            isInlineOnly(block.parentElement)
        ) {
            block = block.parentElement;
        }
        if (!isInlineOnly(block)) return null;

        const contentPath = decodedPath.split('.').slice(0, -2).join('.');
        const markers = markersIn(block);
        if (markers.length === 0) return null;
        for (const marker of markers) {
            if (marker.path.split('.').slice(0, -2).join('.') !== contentPath) return null;
        }
        return { block, contentPath };
    }

    // Fallback when caret lookup finds nothing: walk up from the
    // double-clicked node to the element that renders exactly one annotated
    // value: a leaf element (no element children) whose text carries exactly
    // one stega marker. Mixed rich-text paragraphs never qualify as a whole,
    // so their structure cannot be flattened by an inline edit.
    function findEditableAt(target: EventTarget | null): { el: HTMLElement; sliceId: string; path: string } | null {
        let el: Element | null = target instanceof Element ? target : null;
        while (el && el !== document.body) {
            const text = el.textContent ?? '';
            if (text.includes(STEGA_PREFIX)) {
                if (!(el instanceof HTMLElement) || el.childElementCount > 0) return null;
                if (text.split(STEGA_PREFIX).length !== 2) return null;
                const decoded = decodeStega(text);
                return decoded ? { el, ...decoded } : null;
            }
            el = el.parentElement;
        }
        return null;
    }

    function startInlineEdit(
        { el, sliceId, path }: { el: HTMLElement; sliceId: string; path: string },
        unwrapAfter = false,
    ): void {
        editingElement = el;
        // Strip the invisible markers before editing so the caret never
        // lands inside them. The original (marker-carrying) text is kept: an
        // unchanged session restores it, because without a data change no
        // re-render comes along to re-annotate — and without markers the
        // element would silently stop being editable.
        const originalText = el.textContent ?? '';
        el.textContent = stripStega(originalText);
        el.setAttribute('contenteditable', 'plaintext-only');
        if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
        el.style.outline = EDITING_OUTLINE;
        el.style.outlineOffset = '2px';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        send({ type: 'ndocms:inline-edit-start', sliceId, path });

        // Floating toolbar above the edited text, in the section-toolbar
        // style. Its buttons arrive via the editor's edit-config answer, so
        // they always mirror what the field's panel editor allows. mousedown
        // is cancelled on every button so the editable never loses focus
        // (blur would end the session).
        const toolbar = document.createElement('div');
        toolbar.style.cssText =
            'position:absolute;display:none;gap:4px;padding:3px;background:#ffffff;z-index:2147483001;' +
            'border:1px solid #d1d5db;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.15);';
        const positionToolbar = () => {
            const rect = el.getBoundingClientRect();
            toolbar.style.top = `${Math.max(rect.top + window.scrollY - 42, 4)}px`;
            toolbar.style.left = `${Math.max(rect.left + window.scrollX, 4)}px`;
        };

        // Only push when the text actually changed since the last push: the
        // safety push on blur must never overwrite a structural change (mark
        // split) that was applied in between from the same editor state.
        let lastPushed = stripStega(originalText);
        const pushValue = () => {
            const value = stripStega(el.textContent ?? '');
            if (value === lastPushed) return;
            lastPushed = value;
            send({ type: 'ndocms:inline-edit', sliceId, path, value });
        };

        editToolbarFill = (config) => {
            toolbar.replaceChildren();
            if (config.canClear) {
                // Clearing commits the empty value and ends the session: the
                // re-render then hides the element like the live site would.
                const clear = overlayButton('', 'Leegmaken', () => {
                    el.textContent = '';
                    pushValue();
                    el.blur();
                });
                clear.innerHTML = TRASH_SVG;
                clear.addEventListener('mousedown', (event) => event.preventDefault());
                toolbar.appendChild(clear);
            }
            toolbar.style.display = toolbar.childElementCount > 0 ? 'flex' : 'none';
            positionToolbar();
        };
        editToolbar = toolbar;
        document.documentElement.appendChild(toolbar);

        const onInput = () => {
            pushValue();
            positionToolbar();
        };
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                el.blur();
            }
        };
        const finish = () => {
            el.removeEventListener('input', onInput);
            el.removeEventListener('keydown', onKeydown);
            el.removeAttribute('contenteditable');
            el.style.outline = '';
            el.style.outlineOffset = '';
            toolbar.remove();
            editToolbar = null;
            editToolbarFill = null;
            editingElement = null;
            pushValue();
            // Unchanged text: restore the marker-carrying original so the
            // element stays editable without needing a re-render.
            const finalText = el.textContent ?? '';
            const unchanged = finalText === stripStega(originalText);
            if (unwrapAfter) {
                el.replaceWith(document.createTextNode(unchanged ? originalText : finalText));
            } else if (unchanged) {
                el.textContent = originalText;
            }
            send({ type: 'ndocms:inline-edit-end' });
        };
        el.addEventListener('input', onInput);
        el.addEventListener('keydown', onKeydown);
        el.addEventListener('blur', finish, { once: true });
    }

    // Rich-text editing: the whole block (paragraph, list item, heading) is
    // one contenteditable surface with its formatting intact. B/I/S/link run
    // as real selection commands; every change serializes the block's inline
    // DOM back to structured nodes and replaces the block's content array.
    function startRichEdit(el: HTMLElement, sliceId: string, contentPath: string, caretNode?: Text, caretOffset?: number): void {
        editingElement = el;
        const originalHtml = el.innerHTML;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            node.nodeValue = stripStega(node.nodeValue ?? '');
        }
        el.setAttribute('contenteditable', 'true');
        try {
            // Tags (b/i/strike), not style spans — the serializer reads tags.
            document.execCommand('styleWithCSS', false, 'false');
        } catch {
            // Older engines; execCommand output stays parseable either way.
        }
        el.style.outline = EDITING_OUTLINE;
        el.style.outlineOffset = '2px';
        el.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        if (caretNode && caretNode.isConnected) {
            range.setStart(caretNode, Math.min(caretOffset ?? 0, caretNode.nodeValue?.length ?? 0));
            range.collapse(true);
        } else {
            range.selectNodeContents(el);
            range.collapse(false);
        }
        selection?.removeAllRanges();
        selection?.addRange(range);

        send({ type: 'ndocms:inline-edit-start', sliceId, path: contentPath });

        const toolbar = document.createElement('div');
        toolbar.style.cssText =
            'position:absolute;display:none;gap:4px;padding:3px;background:#ffffff;z-index:2147483001;' +
            'border:1px solid #d1d5db;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.15);';
        const positionToolbar = () => {
            const rect = el.getBoundingClientRect();
            toolbar.style.top = `${Math.max(rect.top + window.scrollY - 42, 4)}px`;
            toolbar.style.left = `${Math.max(rect.left + window.scrollX, 4)}px`;
        };

        const initialJson = JSON.stringify(serializeInline(el));
        let lastPushed = initialJson;
        const push = () => {
            const nodes = serializeInline(el);
            const json = JSON.stringify(nodes);
            if (json === lastPushed) return;
            lastPushed = json;
            send({ type: 'ndocms:inline-rich', sliceId, path: contentPath, nodes });
        };

        // While the link input has focus the editable blurs; the session
        // must survive that instead of committing.
        let suspended = false;
        let currentConfig: EditConfigMessage | null = null;

        // Swap the toolbar for an inline URL input (nicer than the browser
        // prompt, and it stays inside the edit session).
        function showLinkInput(onSubmit: (href: string | null) => void): void {
            suspended = true;
            const savedSelection = (() => {
                const sel = window.getSelection();
                return sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
            })();

            const done = (href: string | null) => {
                suspended = false;
                el.focus();
                if (savedSelection) {
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(savedSelection);
                }
                if (currentConfig) editToolbarFill?.(currentConfig);
                onSubmit(href);
            };

            toolbar.replaceChildren();
            const input = document.createElement('input');
            input.type = 'url';
            input.placeholder = 'https://…';
            input.style.cssText =
                'width:220px;border:1px solid #d1d5db;border-radius:9999px;padding:3px 12px;' +
                'font:13px/1.4 system-ui,sans-serif;color:#111827;background:#ffffff;outline:none;';
            input.addEventListener('focus', () => {
                input.style.borderColor = '#6366f1';
            });
            input.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                    event.preventDefault();
                    done(input.value.trim() || null);
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    done(null);
                }
            });
            input.addEventListener('blur', () => {
                // Clicking anywhere else cancels; OK/cancel prevent this via
                // their mousedown handlers.
                setTimeout(() => {
                    if (suspended) done(null);
                }, 0);
            });
            const ok = overlayButton('✓', 'Toepassen', () => done(input.value.trim() || null));
            const cancel = overlayButton('✕', 'Annuleren', () => done(null));
            for (const button of [ok, cancel]) {
                button.addEventListener('mousedown', (event) => event.preventDefault());
            }
            toolbar.append(input, ok, cancel);
            positionToolbar();
            input.focus();
        }

        function execButton(mark: InlineMarkType): HTMLButtonElement {
            const labels: Record<InlineMarkType, [string, string]> = {
                bold: ['B', 'Vet'],
                italic: ['I', 'Cursief'],
                strike: ['S', 'Doorhalen'],
                link: ['', 'Link'],
            };
            const [label, title] = labels[mark];
            const button = overlayButton(label, title, () => undefined);
            if (mark === 'bold') button.style.fontWeight = '700';
            if (mark === 'italic') button.style.fontStyle = 'italic';
            if (mark === 'strike') button.style.textDecoration = 'line-through';
            if (mark === 'link') button.innerHTML = LINK_SVG;
            button.addEventListener('mousedown', (event) => event.preventDefault());
            button.addEventListener('click', () => {
                const sel = window.getSelection();
                // No usable selection: apply to the whole block.
                if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !el.contains(sel.anchorNode)) {
                    const all = document.createRange();
                    all.selectNodeContents(el);
                    sel?.removeAllRanges();
                    sel?.addRange(all);
                }
                if (mark === 'link') {
                    const anchorEl = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
                    if (anchorEl?.closest('a')) {
                        document.execCommand('unlink');
                    } else {
                        showLinkInput((href) => {
                            if (!href) return;
                            document.execCommand('createLink', false, href);
                            push();
                        });
                        return;
                    }
                } else {
                    document.execCommand({ bold: 'bold', italic: 'italic', strike: 'strikeThrough' }[mark]);
                }
                push();
                positionToolbar();
                el.focus();
            });
            return button;
        }

        editToolbarFill = (config) => {
            currentConfig = config;
            toolbar.replaceChildren();
            for (const mark of config.marks) {
                toolbar.appendChild(execButton(mark));
            }
            toolbar.style.display = toolbar.childElementCount > 0 ? 'flex' : 'none';
            positionToolbar();
        };
        editToolbar = toolbar;
        document.documentElement.appendChild(toolbar);

        const onInput = () => {
            push();
            positionToolbar();
        };
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                el.blur();
            }
        };
        const onBlur = () => {
            if (suspended) return;
            finish();
        };
        const finish = () => {
            el.removeEventListener('input', onInput);
            el.removeEventListener('keydown', onKeydown);
            el.removeEventListener('blur', onBlur);
            el.removeAttribute('contenteditable');
            el.style.outline = '';
            el.style.outlineOffset = '';
            toolbar.remove();
            editToolbar = null;
            editToolbarFill = null;
            editingElement = null;
            push();
            // Unchanged block: restore the marker-carrying markup so it stays
            // editable without a re-render.
            if (JSON.stringify(serializeInline(el)) === initialJson && lastPushed === initialJson) {
                el.innerHTML = originalHtml;
            }
            send({ type: 'ndocms:inline-edit-end' });
        };
        el.addEventListener('input', onInput);
        el.addEventListener('keydown', onKeydown);
        el.addEventListener('blur', onBlur);
    }

    // Astro bundles CSS per page: the empty shell does not include the slice
    // styles the rendered result needs, so missing head assets are merged in
    // on every swap. Bridge-added inline styles are tagged and replaced each
    // render to avoid unbounded accumulation.
    function mergeHeadAssets(newHead: HTMLHeadElement): void {
        const existingHrefs = new Set(
            Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).map((link) =>
                link.getAttribute('href'),
            ),
        );

        for (const link of Array.from(newHead.querySelectorAll('link[rel="stylesheet"]'))) {
            const href = link.getAttribute('href');
            if (!href || existingHrefs.has(href)) continue;
            document.head.appendChild(document.importNode(link, true));
            existingHrefs.add(href);
        }

        document.head.querySelectorAll('style[data-ndocms-added]').forEach((style) => style.remove());
        const shellStyles = new Set(
            Array.from(document.head.querySelectorAll('style:not([data-ndocms-added])')).map(
                (style) => style.textContent,
            ),
        );

        for (const style of Array.from(newHead.querySelectorAll('style'))) {
            if (shellStyles.has(style.textContent)) continue;
            const imported = document.importNode(style, true);
            imported.setAttribute('data-ndocms-added', '');
            document.head.appendChild(imported);
        }
    }

    // Scripts parsed by DOMParser never execute, so slice interactivity
    // (booking widget, form setup, nav toggle) would stay dead after a body
    // swap. Re-inject executable clones of every script the shell doesn't
    // already carry; the cache-buster forces modules to actually re-run.
    function reExecuteScripts(scripts: HTMLScriptElement[]): void {
        scriptRunCounter += 1;
        const shellSrcs = new Set(
            Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src]')).map(
                (script) => script.src.split('?')[0],
            ),
        );
        const shellInline = new Set(
            Array.from(document.head.querySelectorAll('script:not([src])')).map((script) => script.textContent),
        );

        for (const script of scripts) {
            const type = script.getAttribute('type');
            if (type && type !== 'module' && type !== 'text/javascript') continue;

            const clone = document.createElement('script');
            if (type) clone.type = type;

            const src = script.getAttribute('src');
            if (src) {
                const absolute = new URL(src, window.location.href).href;
                if (shellSrcs.has(absolute.split('?')[0])) continue;
                clone.src = `${absolute}${absolute.includes('?') ? '&' : '?'}ndocmsRun=${scriptRunCounter}`;
            } else {
                if (!script.textContent || shellInline.has(script.textContent)) continue;
                clone.textContent = script.textContent;
            }
            document.body.appendChild(clone);
        }
    }

    async function render(message: RenderMessage): Promise<void> {
        renderAbort?.abort();
        const abort = new AbortController();
        renderAbort = abort;

        let html: string;
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (message.token) headers['X-Ndocms-Preview-Token'] = message.token;
            const response = await fetch('/_ndocms/render', {
                method: 'POST',
                headers,
                body: JSON.stringify({ data: message.data }),
                signal: abort.signal,
            });
            if (!response.ok) throw new Error(`render failed: ${response.status}`);
            html = await response.text();
        } catch {
            if (abort.signal.aborted) return;
            send({ type: 'ndocms:render-error', requestId: message.requestId });
            return;
        }
        if (abort.signal.aborted) return;

        // Never swap the body away under an active inline edit; the editor
        // re-renders once the edit session ends anyway.
        if (editingElement) {
            send({ type: 'ndocms:rendered', requestId: message.requestId, sliceIds: renderedSliceIds() });
            return;
        }

        const parsed = new DOMParser().parseFromString(html, 'text/html');
        mergeHeadAssets(parsed.head);

        // Collect scripts before adoptNode moves the body out of the parsed document.
        const scripts = Array.from(parsed.querySelectorAll('script'));
        const scrollY = window.scrollY;
        document.body = document.adoptNode(parsed.body);
        window.scrollTo({ top: scrollY, behavior: 'instant' });
        reExecuteScripts(scripts);
        resizeObserver?.disconnect();
        resizeObserver?.observe(document.body);
        applyHighlights();
        rebuildOverlay();

        send({ type: 'ndocms:rendered', requestId: message.requestId, sliceIds: renderedSliceIds() });
    }

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.origin !== editorOrigin || event.source !== window.parent) return;
        const message = event.data as EditorMessage;
        if (!message || typeof message.type !== 'string' || !message.type.startsWith('ndocms:')) return;

        switch (message.type) {
            case 'ndocms:render':
                void render(message);
                break;
            case 'ndocms:select':
                selectedId = message.sliceId;
                applyHighlights();
                rebuildOverlay();
                if (selectedId) scrollToSlice(selectedId);
                break;
            case 'ndocms:hover':
                setHovered(message.sliceId);
                break;
            case 'ndocms:edit-config':
                editToolbarFill?.(message);
                break;
        }
    });

    // Edit mode: a click selects the section instead of following links or
    // triggering slice interactivity. Capture phase, so nothing else runs.
    // Overlay buttons keep their own click handling.
    document.addEventListener(
        'click',
        (event) => {
            if (event.target instanceof Node && overlay.contains(event.target)) return;
            if (editToolbar && event.target instanceof Node && editToolbar.contains(event.target)) return;
            // Clicks inside the active inline edit must reach the caret
            // (placed on mousedown), but never follow the anchor the edited
            // text may live in — a button label sits inside its <a>.
            if (editingElement && event.target instanceof Node && editingElement.contains(event.target)) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!plainMode) send({ type: 'ndocms:slice-click', sliceId: closestSliceId(event.target) });
        },
        true,
    );

    // Middle clicks open links in a new tab regardless of the click handler.
    document.addEventListener(
        'auxclick',
        (event) => {
            if (event.target instanceof Node && (overlay.contains(event.target) || editToolbar?.contains(event.target))) return;
            event.preventDefault();
        },
        true,
    );

    if (!plainMode) {
        document.addEventListener(
            'dblclick',
            (event) => {
                if (event.target instanceof Node && overlay.contains(event.target)) return;
                if (editingElement) return;

                const iconSvg = event.target instanceof Element ? event.target.closest('svg[data-ndocms-icon]') : null;
                if (iconSvg) {
                    event.preventDefault();
                    event.stopPropagation();
                    send({
                        type: 'ndocms:icon-edit',
                        sliceId: closestSliceId(iconSvg),
                        name: iconSvg.getAttribute('data-ndocms-icon') ?? '',
                    });
                    return;
                }

                if (event.target instanceof HTMLImageElement) {
                    event.preventDefault();
                    event.stopPropagation();
                    send({ type: 'ndocms:image-edit', src: event.target.currentSrc || event.target.src });
                    return;
                }

                // Prefer the exact text node under the pointer: it survives
                // decorative siblings. Rich text opens the whole block as one
                // formatted surface; plain text fields get a temporary
                // wrapper (removed again when the edit ends).
                const hit = markedTextNodeAt(event.clientX, event.clientY);
                if (hit) {
                    const decoded = decodeStega(hit.node.nodeValue ?? '');
                    if (decoded) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (RICH_TEXT_PATH_RE.test(decoded.path)) {
                            const rich = richBlockFor(hit.node, decoded.path);
                            if (rich) {
                                startRichEdit(rich.block, decoded.sliceId, rich.contentPath, hit.node, hit.offset);
                                return;
                            }
                        }
                        const wrapper = document.createElement('span');
                        hit.node.parentNode?.insertBefore(wrapper, hit.node);
                        wrapper.appendChild(hit.node);
                        startInlineEdit({ el: wrapper, ...decoded }, true);
                        return;
                    }
                }

                const editable = findEditableAt(event.target);
                if (!editable) return;
                event.preventDefault();
                event.stopPropagation();
                startInlineEdit(editable);
            },
            true,
        );

        document.addEventListener('mouseover', (event) => {
            // Hovering the overlay (toolbar/insert buttons) keeps the section hover.
            if (event.target instanceof Node && overlay.contains(event.target)) return;
            if (editToolbar && event.target instanceof Node && editToolbar.contains(event.target)) return;
            const id = closestSliceId(event.target);
            setHovered(id);
            if (id !== lastReportedHoverId) {
                lastReportedHoverId = id;
                send({ type: 'ndocms:slice-hover', sliceId: id });
            }
        });

        document.addEventListener('mouseleave', () => {
            lastReportedHoverId = null;
            setHovered(null);
            send({ type: 'ndocms:slice-hover', sliceId: null });
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                send({ type: 'ndocms:slice-click', sliceId: null });
            }
        });

        window.addEventListener('resize', () => rebuildOverlay());
    }

    rebuildOverlay();
    send({ type: 'ndocms:ready', version: PROTOCOL_VERSION });
}
