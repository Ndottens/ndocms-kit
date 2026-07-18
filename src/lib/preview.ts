import type { AstroIntegration } from 'astro';

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
