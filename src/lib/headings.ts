import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AstroIntegration } from 'astro';

/**
 * Warns about built pages that have no `<h1>`, or more than one.
 *
 * A slice renders its heading only when the editor filled the field in, so a
 * page whose header slice has an empty heading ships without an h1 and nothing
 * says so: it looks right, because the next heading is styled the same. That is
 * how a live page ended up with zero h1 elements without anyone noticing.
 *
 * This warns rather than fails. The cause is almost always an empty field in the
 * CMS, and a content mistake should not be able to break a deploy — but it
 * should be impossible to miss in the build log.
 */

const H1 = /<h1[\s>]/gi;

async function htmlFiles(dir: string): Promise<string[]> {
    const found: string[] = [];

    async function walk(current: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.name.endsWith('.html')) {
                found.push(full);
            }
        }
    }

    await walk(dir);
    return found;
}

export function ndocmsHeadingCheck(): AstroIntegration {
    return {
        name: 'ndocms-heading-check',
        hooks: {
            'astro:build:done': async ({ dir, logger }) => {
                const root = fileURLToPath(dir);
                const missing: string[] = [];
                const duplicated: string[] = [];

                for (const file of await htmlFiles(root)) {
                    // 404 and 500 are not pages anyone should rank; skip them.
                    const relative = path.relative(root, file);
                    if (/^(404|500)(\/index)?\.html$/.test(relative)) continue;

                    const html = await readFile(file, 'utf8');
                    const count = (html.match(H1) ?? []).length;
                    if (count === 0) missing.push(relative);
                    if (count > 1) duplicated.push(`${relative} (${count})`);
                }

                if (missing.length) {
                    logger.warn(
                        `No <h1> on ${missing.length} page(s): ${missing.join(', ')}. ` +
                            'Usually an empty heading field on the header or hero slice.',
                    );
                }
                if (duplicated.length) {
                    logger.warn(`More than one <h1> on: ${duplicated.join(', ')}.`);
                }
            },
        },
    };
}
