// Cloudflare serves the built pages as directories, so `/contact` is answered
// with a 307 to `/contact/`. The sitemap and the canonical already use the
// trailing-slash form; navigation links written in the CMS usually do not, which
// puts an extra hop on every internal click and every crawl of the site.
//
// Normalising at render time keeps the CMS field forgiving: an editor may type
// `/contact`, `contact` or the full URL, and the markup still points straight at
// the canonical form.

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Point an internal link straight at the URL the server actually serves.
 *
 * Leaves anything that is not a plain internal path untouched: absolute URLs,
 * protocol-relative URLs, `mailto:`/`tel:`, in-page anchors and query-only
 * links. A path that already ends in a slash, or that looks like a file
 * (`/llms.txt`), is returned unchanged.
 */
export function internalHref(href: unknown, fallback = '#'): string {
    if (typeof href !== 'string') return fallback;

    const value = href.trim();
    if (!value) return fallback;

    // Not ours to rewrite: other schemes, other hosts, anchors and queries.
    if (EXTERNAL.test(value) || value.startsWith('#') || value.startsWith('?')) return value;

    // Split off anchor and query so `/contact#form` becomes `/contact/#form`.
    const marker = value.search(/[?#]/);
    const path = marker === -1 ? value : value.slice(0, marker);
    const suffix = marker === -1 ? '' : value.slice(marker);

    if (!path || path === '/') return `/${suffix}`;
    if (path.endsWith('/')) return `${path}${suffix}`;

    // A dot in the last segment means a file, and files have no directory form.
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) return `${path}${suffix}`;

    const leading = path.startsWith('/') ? path : `/${path}`;
    return `${leading}/${suffix}`;
}
