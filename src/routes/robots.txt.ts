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

    // The canonical host and its www counterpart are the same site to a visitor,
    // so both are allowed. Blocking www would be the one combination that hurts:
    // it still serves the pages, but a crawler that may not fetch them also never
    // reads the canonical tag pointing at the bare domain — so a link to www gets
    // indexed as a blocked URL instead of being folded into the real one.
    const canonical = site
        ? [site.host, site.host.startsWith('www.') ? site.host.slice(4) : `www.${site.host}`]
        : [];

    // Anything else is a preview or a leftover deploy URL. Those pages
    // canonicalise to the real domain, so there is nothing to gain by letting
    // them be crawled and a lot to lose if they are indexed first.
    // With no `site` configured we fall through to Allow: refusing to guess beats
    // shutting a live site out of the index over a missing setting.
    const offCanonicalHost = !!site && !canonical.includes(url.host);
    const rules = offCanonicalHost ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n';

    return new Response(`${rules}\nSitemap: ${sitemap}\n`, {
        headers: { 'Content-Type': 'text/plain' },
    });
};
