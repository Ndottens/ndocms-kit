import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { ndocmsBase, type NdocmsBaseOptions } from './integration';

export interface DefineSiteOptions {
    // The public URL of this client site: drives canonical, sitemap and the
    // absolute URLs in the structured data.
    site: string;
    base?: NdocmsBaseOptions;
    // Extra integrations for this project, appended after the base ones.
    integrations?: Parameters<typeof defineConfig>[0]['integrations'];
}

// The shared Astro setup for a client site. A static SSG build that pulls its
// content from the NdoCMS Delivery API; the Cloudflare adapter serves only the
// on-demand /_ndocms/render route of the story editor.
export function defineSite({ site, base, integrations = [] }: DefineSiteOptions) {
    return defineConfig({
        site,
        output: 'static',
        adapter: cloudflare(),
        integrations: [
            sitemap({ filter: (page) => !page.includes('/_ndocms/') }),
            ndocmsBase(base),
            ...integrations,
        ],
        // One ~10 kB stylesheet is otherwise a render-blocking request on the
        // critical path (~160 ms on slow 4G), which weighs heavier on these
        // sites than sharing the cache between pages.
        build: { inlineStylesheets: 'always' },
        vite: {
            plugins: [tailwindcss()],
        },
    });
}
