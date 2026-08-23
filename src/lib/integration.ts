import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

// The base routes live in this package so every client site shares them instead
// of carrying its own copy. They need three things from the project — the
// layout (fonts + tokens), the slice registry and the design rhythm — which
// they import through `virtual:ndocms/*`; this integration points those at the
// project's real files. Design and content stay in the project, plumbing stays
// here.
export interface NdocmsBaseOptions {
    // Only set these when a project deviates from the conventional layout.
    layout?: string;
    slices?: string;
    design?: string;
    site?: string;
    // Turn a base route off when the project hand-designs it (see the blog post
    // route of ndodevelopment).
    routes?: {
        landing?: boolean;
        robots?: boolean;
        llms?: boolean;
        preview?: boolean;
    };
}

const DEFAULTS = {
    layout: 'src/layouts/SiteLayout.astro',
    slices: 'src/slices.ts',
    design: 'src/design.ts',
    site: 'src/site.ts',
};

export function ndocmsBase(options: NdocmsBaseOptions = {}): AstroIntegration {
    const routes = { landing: true, robots: true, llms: true, preview: true, ...options.routes };

    return {
        name: 'ndocms-base',
        hooks: {
            'astro:config:setup': ({ config, injectRoute, updateConfig }) => {
                const root = fileURLToPath(config.root);
                const resolve = (key: keyof typeof DEFAULTS) =>
                    path.resolve(root, options[key] ?? DEFAULTS[key]);

                updateConfig({
                    vite: {
                        resolve: {
                            alias: {
                                'virtual:ndocms/layout': resolve('layout'),
                                'virtual:ndocms/slices': resolve('slices'),
                                'virtual:ndocms/design': resolve('design'),
                                'virtual:ndocms/site': resolve('site'),
                            },
                        },
                    },
                });

                if (routes.landing) {
                    injectRoute({ pattern: '/[...uid]', entrypoint: 'ndocms-kit/routes/landing.astro' });
                }
                // On demand, because one deployment answers on both the canonical
                // domain and the *.workers.dev host, and only the request says
                // which. See the route itself.
                if (routes.robots) {
                    injectRoute({
                        pattern: '/robots.txt',
                        entrypoint: 'ndocms-kit/routes/robots.txt.ts',
                        prerender: false,
                    });
                }
                if (routes.llms) {
                    injectRoute({ pattern: '/llms.txt', entrypoint: 'ndocms-kit/routes/llms.txt.ts' });
                }
                // Underscore-prefixed paths are excluded from file-based routing,
                // so the story editor's render route can only be injected. Every
                // other page stays prerendered; only this one runs on demand.
                if (routes.preview) {
                    injectRoute({
                        pattern: '/_ndocms/render',
                        entrypoint: 'ndocms-kit/routes/ndocms-render.astro',
                        prerender: false,
                    });
                }
            },
        },
    };
}
