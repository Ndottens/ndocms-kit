import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sitemap from '@astrojs/sitemap';
import type { AstroIntegration } from 'astro';

/**
 * sitemap.xml, minus the pages that asked to stay out of it.
 *
 * @astrojs/sitemap lists every page it built and knows nothing about the SEO
 * panel of a document; the page itself knows, but by the time the sitemap is
 * written the pages have long been rendered. So the page leaves a marker in its
 * own <head> (Base.astro) and this integration reads it back off disk.
 *
 * Doing it through the built HTML instead of a second trip to the Delivery API
 * keeps it honest in two ways: no URL has to be reconstructed from a uid and a
 * custom-type prefix, and a hand-built project page that sets noindex is covered
 * without knowing this code exists.
 *
 * 404 and 500 need no handling: the sitemap integration skips status pages, and
 * the preview route is not prerendered.
 */
const MARKER = 'name="ndocms-sitemap"';

// '/blog/post/' and 'blog/post' are the same page; the pages we get from the
// build and the URLs the filter gets are not written the same way.
function key(pathname: string): string {
    return pathname.replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathnameOf(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

async function readBuiltPage(dir: URL, pathname: string): Promise<string | null> {
    const root = fileURLToPath(dir);
    const relative = key(pathname);
    // build.format 'directory' writes about/index.html, 'file' writes about.html.
    const candidates = [
        path.join(root, relative, 'index.html'),
        path.join(root, relative === '' ? 'index.html' : `${relative}.html`),
    ];

    for (const candidate of candidates) {
        try {
            return await readFile(candidate, 'utf8');
        } catch {
            // Next candidate; a page that is not on disk is simply not excluded.
        }
    }

    return null;
}

function exclusionScanner(excluded: Set<string>): AstroIntegration {
    return {
        name: 'ndocms-sitemap-exclusions',
        hooks: {
            'astro:build:done': async ({ dir, pages }) => {
                excluded.clear();

                for (const page of pages) {
                    const html = await readBuiltPage(dir, page.pathname);

                    if (html?.includes(MARKER)) {
                        excluded.add(key(page.pathname));
                    }
                }
            },
        },
    };
}

// Returned as a pair, and in this order: integration hooks run in the order of
// the array, so the scan has to be listed before the sitemap that reads it.
export function ndocmsSitemap(): AstroIntegration[] {
    const excluded = new Set<string>();

    return [
        exclusionScanner(excluded),
        sitemap({
            filter: (page) => {
                const pathname = pathnameOf(page);

                return !pathname.includes('/_ndocms/') && !excluded.has(key(pathname));
            },
        }),
    ];
}
