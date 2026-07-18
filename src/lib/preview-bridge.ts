// Browser-side bridge for the NdoCMS story editor. Loaded only on the
// /_ndocms/render shell (via PreviewBridge.astro), never on production pages.
//
// The editor embeds the shell in an iframe and talks postMessage; the bridge
// POSTs draft data to its own origin, swaps the <body> with the rendered
// result, reports DOM events (clicks/hovers on sections) back to the editor
// and draws the selection/hover highlights. The message protocol is mirrored
// in the CMS (resources/js/lib/previewProtocol.ts).

const PROTOCOL_VERSION = 1;

const SELECTED_OUTLINE = '2px solid #6366f1';
const HOVER_OUTLINE = '2px dashed rgba(99, 102, 241, 0.65)';

interface RenderMessage {
    type: 'ndocms:render';
    requestId: number;
    data: { slices?: unknown[] } & Record<string, unknown>;
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

    let renderAbort: AbortController | null = null;
    let selectedId: string | null = null;
    let hoveredId: string | null = null;
    let lastReportedHoverId: string | null = null;

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

    async function render(message: RenderMessage): Promise<void> {
        renderAbort?.abort();
        const abort = new AbortController();
        renderAbort = abort;

        let html: string;
        try {
            const response = await fetch('/_ndocms/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

        const parsed = new DOMParser().parseFromString(html, 'text/html');
        mergeHeadAssets(parsed.head);

        const scrollY = window.scrollY;
        document.body = document.adoptNode(parsed.body);
        window.scrollTo({ top: scrollY, behavior: 'instant' });
        applyHighlights();

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
                if (selectedId) scrollToSlice(selectedId);
                break;
            case 'ndocms:hover':
                hoveredId = message.sliceId;
                applyHighlights();
                break;
        }
    });

    // Edit mode: a click selects the section instead of following links or
    // triggering slice interactivity. Capture phase, so nothing else runs.
    document.addEventListener(
        'click',
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            send({ type: 'ndocms:slice-click', sliceId: closestSliceId(event.target) });
        },
        true,
    );

    document.addEventListener('mouseover', (event) => {
        const id = closestSliceId(event.target);
        hoveredId = id;
        applyHighlights();
        if (id !== lastReportedHoverId) {
            lastReportedHoverId = id;
            send({ type: 'ndocms:slice-hover', sliceId: id });
        }
    });

    document.addEventListener('mouseleave', () => {
        hoveredId = null;
        lastReportedHoverId = null;
        applyHighlights();
        send({ type: 'ndocms:slice-hover', sliceId: null });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            send({ type: 'ndocms:slice-click', sliceId: null });
        }
    });

    send({ type: 'ndocms:ready', version: PROTOCOL_VERSION });
}
