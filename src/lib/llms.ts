// Generates /llms.txt (llmstxt.org): a plain-markdown index of the site for
// AI assistants and LLM crawlers — robots.txt's "who may crawl" counterpart
// for "what is this site and where is the important content".
import { getAllDocuments } from './delivery';
import type { DeliveryDocument } from './types';
import type { SiteConfig } from './site-config';

function seoOf(document: DeliveryDocument): Record<string, unknown> {
    return (document.data.seo ?? {}) as Record<string, unknown>;
}

function isHidden(document: DeliveryDocument): boolean {
    return seoOf(document).hide_from_search === true;
}

function titleOf(document: DeliveryDocument): string {
    const seo = seoOf(document);
    if (typeof seo.meta_title === 'string' && seo.meta_title) return seo.meta_title;
    if (typeof document.data.title === 'string' && document.data.title) return document.data.title;
    return document.uid;
}

function line(document: DeliveryDocument, url: string): string {
    const seo = seoOf(document);
    const description = typeof seo.meta_description === 'string' && seo.meta_description ? `: ${seo.meta_description}` : '';
    return `- [${titleOf(document)}](${url})${description}`;
}

export async function buildLlmsTxt(site: SiteConfig, origin: string | undefined): Promise<string> {
    const base = origin ?? '/';
    const abs = (path: string) => new URL(path, base).href;

    const pages = (await getAllDocuments('landing_page')).filter((document) => !isHidden(document));
    const posts = (await getAllDocuments('blog_page')).filter((document) => !isHidden(document));

    const sections = [
        `# ${site.name}`,
        '',
        `> ${site.description}`,
        '',
        '## Pagina’s',
        '',
        ...pages.map((document) => line(document, abs(document.is_homepage ? '/' : `/${document.uid}/`))),
    ];

    if (posts.length > 0) {
        sections.push('', '## Blog', '', ...posts.map((document) => line(document, abs(`/blog/${document.uid}/`))));
    }

    return sections.join('\n') + '\n';
}
