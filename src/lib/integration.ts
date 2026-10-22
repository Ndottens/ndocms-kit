import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration, AstroIntegrationLogger, InjectedRoute } from 'astro';
import { loadEnv } from 'vite';
import { fallbackUrlPrefix, loadUrlPrefixes } from './url-prefixes';

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

const CUSTOM_TYPES_DIR = 'src/custom-types';

/**
 * The pages of a routed custom type live in src/custom-types/<api_id>/:
 * page.astro renders one document, index.astro the overview. They are mounted
 * under the prefix the CMS has for this site, so the folder names the type and
 * never the URL — a site that moves /faq to /fragen changes nothing here.
 */
async function injectCustomTypeRoutes(
    root: string,
    mode: string,
    injectRoute: (route: InjectedRoute) => void,
    logger: AstroIntegrationLogger,
): Promise<void> {
    const dir = path.join(root, CUSTOM_TYPES_DIR);
    if (!existsSync(dir)) {
        return;
    }

    const types = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    if (types.length === 0) {
        return;
    }

    const prefixes = await loadUrlPrefixes(loadEnv(mode, root, 'NDOCMS_'));

    for (const type of types) {
        const prefix = prefixes ? prefixes[type] : fallbackUrlPrefix(type);
        if (!prefix) {
            throw new Error(
                `${CUSTOM_TYPES_DIR}/${type}: the CMS has no URL prefix for "${type}". The folder must carry the api_id of a custom type with a url_prefix.`,
            );
        }

        const page = path.join(dir, type, 'page.astro');
        const index = path.join(dir, type, 'index.astro');
        if (existsSync(page)) {
            injectRoute({ pattern: `/${prefix}/[uid]`, entrypoint: page });
        }
        if (existsSync(index)) {
            injectRoute({ pattern: `/${prefix}`, entrypoint: index });
        }
        logger.info(`${type} → /${prefix}${prefixes ? '' : ' (fixture)'}`);
    }
}

export function ndocmsBase(options: NdocmsBaseOptions = {}): AstroIntegration {
    const routes = { landing: true, robots: true, llms: true, preview: true, ...options.routes };

    return {
        name: 'ndocms-base',
        hooks: {
            'astro:config:setup': async ({ config, command, injectRoute, updateConfig, logger }) => {
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

                await injectCustomTypeRoutes(root, command === 'dev' ? 'development' : 'production', injectRoute, logger);

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
