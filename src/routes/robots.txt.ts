import type { APIRoute } from 'astro';

// Served on demand rather than prerendered. One deployment answers on both the
// canonical domain and the *.workers.dev host it was deployed to, and that stays
// true after the domain switch, so only the incoming request tells us which host
// a crawler is on. A build-time flag cannot tell them apart.
export const prerender = false;

// Generated so the Sitemap line is an absolute URL (per the robots spec),
// derived from `site` in astro.config.
export const GET: APIRoute = ({ site, url }) => {
    const sitemap = site ? new URL('sitemap-index.xml', site).href : '/sitemap-index.xml';

    // A host other than the canonical one is a preview or a leftover deploy URL.
    // Those pages canonicalise to the real domain, so there is nothing to gain by
    // letting them be crawled and a lot to lose if they are indexed first.
    // With no `site` configured we fall through to Allow: refusing to guess beats
    // shutting a live site out of the index over a missing setting.
    const offCanonicalHost = !!site && url.host !== site.host;
    const rules = offCanonicalHost ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n';

    return new Response(`${rules}\nSitemap: ${sitemap}\n`, {
        headers: { 'Content-Type': 'text/plain' },
    });
};
