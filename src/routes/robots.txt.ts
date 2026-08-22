import type { APIRoute } from 'astro';

// Generated at build so the Sitemap line is an absolute URL (per the robots spec),
// derived from `site` in astro.config.
export const GET: APIRoute = ({ site }) => {
    const sitemap = site ? new URL('sitemap-index.xml', site).href : '/sitemap-index.xml';
    const body = `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`;

    return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
