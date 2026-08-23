import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { ndocmsBase, type NdocmsBaseOptions } from './integration';
import { ndocmsSitemap } from './sitemap';
import { ndocmsHeadingCheck } from './headings';

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
        // These sites have no server-side session: every page is prerendered and
        // the one on-demand route renders a posted draft. Leaving sessions on
        // makes Wrangler provision a KV namespace per site and ships the session
        // runtime in the worker for nothing.
        session: false,
        integrations: [
            ...ndocmsSitemap(),
            ndocmsBase(base),
            ndocmsHeadingCheck(),
            ...integrations,
        ],
        // 'always' was chosen when the stylesheet was ~10 kB. Measured on a built
        // site it is 58 kB, byte-identical on every page and ~70% of the HTML,
        // and inline CSS has no URL so it can never be reused: every navigation
        // ships and reparses the same bytes. 'auto' inlines what is small enough
        // to stay off the critical path and emits the rest as a hashed file that
        // the `/_astro/*` rule in `_headers` caches for a year — so the second
        // page onwards costs nothing, the way fonts and images already behave.
        build: { inlineStylesheets: 'auto' },
        vite: {
            plugins: [tailwindcss()],
        },
    });
}
