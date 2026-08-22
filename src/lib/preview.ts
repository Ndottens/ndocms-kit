import type { AstroIntegration } from 'astro';

// Reads a site variable for the on-demand render route. Astro 6 removed
// Astro.locals.runtime.env (touching it throws), and `cloudflare:workers` may
// only be imported from code that runs exclusively in the worker — which a
// prerendered page does not. So the route imports it and hands the env in here.
// import.meta.env stays the fallback for local dev.
export function previewRuntimeEnv(env: unknown, key: string): string | undefined {
    const fromRuntime = (env as Record<string, unknown> | null | undefined)?.[key];
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
