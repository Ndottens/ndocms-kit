import type { AstroIntegration } from 'astro';

// Reads site env for the on-demand render route. On the Cloudflare Workers
// runtime non-public vars are NOT inlined into the server bundle
// (import.meta.env is empty there); they live on Astro.locals.runtime.env.
// import.meta.env remains the fallback for local dev.
export function previewRuntimeEnv(locals: unknown, key: string): string | undefined {
    const runtime = (locals as { runtime?: { env?: Record<string, unknown> } } | null)?.runtime;
    const fromRuntime = runtime?.env?.[key];
    if (typeof fromRuntime === 'string' && fromRuntime !== '') return fromRuntime;
    const fromImportMeta = (import.meta as unknown as { env?: Record<string, unknown> }).env?.[key];
    if (typeof fromImportMeta === 'string' && fromImportMeta !== '') return fromImportMeta;
    return undefined;
}

// Registers the on-demand render route used by the NdoCMS story editor.
// The route lives outside src/pages/ (underscore-prefixed paths are excluded
// from Astro's file-based routing), so it is injected here instead. Every
// other page stays prerendered; only this route runs on demand.
export function ndocmsPreview(options: { entrypoint?: string } = {}): AstroIntegration {
    return {
        name: 'ndocms-preview',
        hooks: {
            'astro:config:setup': ({ injectRoute }) => {
                injectRoute({
                    pattern: '/_ndocms/render',
                    entrypoint: options.entrypoint ?? './src/ndocms-render.astro',
                    prerender: false,
                });
            },
        },
    };
}
