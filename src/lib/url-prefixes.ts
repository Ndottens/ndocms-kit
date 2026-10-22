import { deliveryHeaders } from './request';

// The path segment each routed custom type lives under on this site
// (blog_page → "blog", faq_page → "fragen"). The CMS owns it per site; the
// build reads it before any page exists, to mount the routes in
// src/custom-types/ under it. That happens in the Astro config, where
// import.meta.env is not filled yet — so unlike delivery.ts this module takes
// the env from its caller.
export interface UrlPrefixEnv {
    NDOCMS_API_URL?: string;
    NDOCMS_SITE_SLUG?: string;
    NDOCMS_API_KEY?: string;
    NDOCMS_SNAPSHOT_URL?: string;
}

export type UrlPrefixes = Record<string, string>;

// Without a CMS (fixture mode) the build still needs a path; this is the
// convention the seeder follows for the default.
export function fallbackUrlPrefix(type: string): string {
    return type.replace(/_page$/, '').replace(/_/g, '-');
}

function prefixesOf(body: unknown): UrlPrefixes | null {
    const prefixes = (body as { url_prefixes?: unknown } | null)?.url_prefixes;

    return prefixes && typeof prefixes === 'object' && !Array.isArray(prefixes) ? (prefixes as UrlPrefixes) : null;
}

async function fetchPrefixes(url: string, init?: RequestInit): Promise<UrlPrefixes | null> {
    try {
        const response = await fetch(url, init);
        return response.ok ? prefixesOf(await response.json()) : null;
    } catch {
        return null;
    }
}

/**
 * Null in fixture mode. With a CMS configured, a missing answer fails the
 * build: guessing a prefix is exactly the silent 404 this exists to prevent.
 */
export async function loadUrlPrefixes(env: UrlPrefixEnv): Promise<UrlPrefixes | null> {
    const { NDOCMS_API_URL: apiUrl, NDOCMS_SITE_SLUG: slug, NDOCMS_API_KEY: apiKey, NDOCMS_SNAPSHOT_URL: snapshotUrl } = env;
    if (!apiUrl || !slug || !apiKey) {
        return null;
    }

    if (snapshotUrl) {
        const prefixes = await fetchPrefixes(`${snapshotUrl.replace(/\/$/, '')}/site.json?t=${Date.now()}`, {
            headers: { Accept: 'application/json' },
        });
        if (prefixes) {
            return prefixes;
        }
        console.warn('Snapshot site.json unavailable, falling back to the Delivery API for the URL prefixes.');
    }

    const url = `${apiUrl.replace(/\/$/, '')}/v1/sites/${slug}/site`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const prefixes = await fetchPrefixes(url, { headers: deliveryHeaders(apiKey) });
        if (prefixes) {
            return prefixes;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }

    throw new Error(`Could not read the URL prefixes from ${url}. Does the CMS run a version with the /site endpoint?`);
}
