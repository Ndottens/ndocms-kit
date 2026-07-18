// Browser-side bridge for the NdoCMS story editor. Loaded only on the
// /_ndocms/render shell (via PreviewBridge.astro), never on production pages.
//
// The editor embeds the shell in an iframe and talks postMessage; the bridge
// POSTs draft data to its own origin, swaps the <body> with the rendered
// result and reports DOM events (clicks on sections) back to the editor.
// The message protocol is mirrored in the CMS (resources/js/lib/previewProtocol.ts).

const PROTOCOL_VERSION = 1;

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

    function send(message: Record<string, unknown>): void {
        window.parent.postMessage(message, editorOrigin);
    }

    function renderedSliceIds(): string[] {
        return Array.from(document.querySelectorAll('[data-ndocms-slice]'))
            .map((el) => el.getAttribute('data-ndocms-slice'))
            .filter((id): id is string => Boolean(id));
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
        } catch (error) {
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

        send({ type: 'ndocms:rendered', requestId: message.requestId, sliceIds: renderedSliceIds() });
    }

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.origin !== editorOrigin || event.source !== window.parent) return;
        const message = event.data as EditorMessage;
        if (!message || typeof message.type !== 'string' || !message.type.startsWith('ndocms:')) return;

        if (message.type === 'ndocms:render') void render(message);
    });

    send({ type: 'ndocms:ready', version: PROTOCOL_VERSION });
}
