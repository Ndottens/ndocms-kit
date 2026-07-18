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
const EDITING_OUTLINE = '2px solid #10b981';

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

type EditorMessage = RenderMessage | SelectMessage | HoverMessage;

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

    // Walk up from the double-clicked node to the element that renders
    // exactly one annotated value: a leaf element (no element children)
    // whose text carries exactly one stega marker. Mixed rich-text
    // paragraphs (plain runs next to <strong>/<a> children) never qualify
    // as a whole, so their structure cannot be flattened by an inline edit;
    // their formatted segments are leaf elements and remain editable.
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

    function startInlineEdit({ el, sliceId, path }: { el: HTMLElement; sliceId: string; path: string }): void {
        editingElement = el;
        // Strip the invisible markers before editing so the caret never
        // lands inside them; the next render re-annotates the fresh value.
        el.textContent = stripStega(el.textContent ?? '');
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

        send({ type: 'ndocms:inline-edit-start' });

        const pushValue = () => send({ type: 'ndocms:inline-edit', sliceId, path, value: stripStega(el.textContent ?? '') });
        const onInput = () => pushValue();
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
            editingElement = null;
            pushValue();
            send({ type: 'ndocms:inline-edit-end' });
        };
        el.addEventListener('input', onInput);
        el.addEventListener('keydown', onKeydown);
        el.addEventListener('blur', finish, { once: true });
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
        }
    });

    // Edit mode: a click selects the section instead of following links or
    // triggering slice interactivity. Capture phase, so nothing else runs.
    // Overlay buttons keep their own click handling.
    document.addEventListener(
        'click',
        (event) => {
            if (event.target instanceof Node && overlay.contains(event.target)) return;
            // Clicks inside the active inline edit must reach the caret.
            if (editingElement && event.target instanceof Node && editingElement.contains(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!plainMode) send({ type: 'ndocms:slice-click', sliceId: closestSliceId(event.target) });
        },
        true,
    );

    if (!plainMode) {
        document.addEventListener(
            'dblclick',
            (event) => {
                if (event.target instanceof Node && overlay.contains(event.target)) return;
                if (editingElement) return;

                if (event.target instanceof HTMLImageElement) {
                    event.preventDefault();
                    event.stopPropagation();
                    send({ type: 'ndocms:image-edit', src: event.target.currentSrc || event.target.src });
                    return;
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
