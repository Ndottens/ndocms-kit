// The SEO panel of a document, read once and handed to the layout. One place
// decides what the CMS values mean, so a landing page, a blog post and a FAQ
// answer cannot drift apart on it.
import type { DeliveryDocument } from './types';

export interface PageSeo {
    // The editor's meta title, if any. The fallback is the page's own business:
    // a blog post falls back to its title, a landing page to its uid.
    title?: string;
    description?: string;
    shareImage?: string;
    // The meta-robots directive as the editor picked it ('noindex, follow', …).
    // Undefined means the default, which needs no tag: index, follow.
    robots?: string;
    // Whether this page belongs in sitemap.xml (and in llms.txt).
    sitemap: boolean;
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function pageSeo(document: DeliveryDocument): PageSeo {
    const seo = (document.data.seo ?? {}) as Record<string, unknown>;

    // Snapshots are only rewritten on release, so a site can still be serving
    // content from before `hide_from_search` became `robots`. Reading the old
    // key keeps such a page hidden instead of quietly opening it up.
    const legacyHidden = seo.hide_from_search === true;
    const robots = text(seo.robots) ?? (legacyHidden ? 'noindex, nofollow' : undefined);
    const noindex = robots?.includes('noindex') ?? false;

    return {
        title: text(seo.meta_title),
        description: text(seo.meta_description),
        shareImage: (seo.share_image as { url?: string } | undefined)?.url,
        robots,
        // A noindex page in the sitemap is a contradiction — the sitemap asks a
        // crawler to list what the page tells it not to — so noindex decides
        // here too, and the checkbox only covers the pages that stay indexable.
        sitemap: !noindex && seo.exclude_from_sitemap !== true,
    };
}
