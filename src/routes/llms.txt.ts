import type { APIRoute } from 'astro';
import { buildLlmsTxt } from 'ndocms-kit/lib/llms';
import { site } from 'virtual:ndocms/site';

// /llms.txt (llmstxt.org): markdown site-index for AI assistants, generated
// from the published documents at build time.
export const GET: APIRoute = async ({ site: origin }) => {
    return new Response(await buildLlmsTxt(site, origin?.href), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
};
