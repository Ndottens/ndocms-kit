import type { DeliveryDocument } from './types';
import sample from './fixture.json';

let API_URL: string | undefined = import.meta.env.NDOCMS_API_URL;
let SITE_SLUG: string | undefined = import.meta.env.NDOCMS_SITE_SLUG;
let API_KEY: string | undefined = import.meta.env.NDOCMS_API_KEY;
// Optional: base URL of the release snapshots on the CDN (R2), e.g.
// https://pub-….r2.dev/delivery/<slug>. When set, builds read the published
// content straight from the CDN — the shared-hosting Delivery API (and its
// Imunify360 bot protection) stays out of the build path entirely. The API
// remains the fallback when the snapshot is unreachable.
let SNAPSHOT_URL: string | undefined = import.meta.env.NDOCMS_SNAPSHOT_URL;

let configured = Boolean(API_URL && SITE_SLUG && API_KEY);

/**
 * On-demand routes on the Cloudflare Workers runtime get an EMPTY import.meta.env: the site's
 * variables live on Astro.locals.runtime.env instead. Everything above is read
 * at module load and would therefore be undefined there, leaving the delivery
 * helpers in fixture mode — which is why a slice that loads documents shows an
 * empty list in the story editor while the static build is fine.
 *
 * Call this with Astro.locals from such a route, or from a component rendered
 * by one, before reading delivery data. It fills in what is missing and is safe
 * to call repeatedly; outside Cloudflare there is no runtime env and it does
 * nothing.
 */
export function applyRuntimeEnv(locals: unknown): void {
    const env = (locals as { runtime?: { env?: Record<string, unknown> } } | null)?.runtime?.env;
    if (!env) {
        return;
    }

    const read = (key: string): string | undefined => {
        const value = env[key];
        return typeof value === 'string' && value !== '' ? value : undefined;
    };

    API_URL ??= read('NDOCMS_API_URL');
    SITE_SLUG ??= read('NDOCMS_SITE_SLUG');
    API_KEY ??= read('NDOCMS_API_KEY');
    configured = Boolean(API_URL && SITE_SLUG && API_KEY);

    const snapshot = read('NDOCMS_SNAPSHOT_URL');
    if (snapshot && snapshot !== SNAPSHOT_URL) {
        SNAPSHOT_URL = snapshot;
        snapshotDocumentsCache = undefined;
    }
}

// One cache-buster per build: r2.dev caches at the edge and must not serve a
// previous release to this build.
const buildStamp = Date.now();

async function fetchSnapshot(file: string, isValid: (body: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
    if (!SNAPSHOT_URL) {
        return null;
    }
    const url = `${SNAPSHOT_URL.replace(/\/$/, '')}/${file}?t=${buildStamp}`;
    try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }
        const body = (await response.json()) as Record<string, unknown>;
        if (!isValid(body)) {
            throw new Error('unexpected shape');
        }
        return body;
    } catch (error) {
        console.warn(`Snapshot fetch failed for ${file}, falling back to the Delivery API: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

let snapshotDocumentsCache: Promise<DeliveryDocument[] | null> | undefined;

function snapshotDocuments(): Promise<DeliveryDocument[] | null> {
    snapshotDocumentsCache ??= fetchSnapshot('documents.json', (body) => Array.isArray(body.results))
        .then((body) => (body ? (body.results as DeliveryDocument[]) : null));

    return snapshotDocumentsCache;
}

function headers(): HeadersInit {
    return {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
        // Node's default fetch fingerprint (bare UA, minimal headers) trips
        // Imunify360's bot heuristics on the shared-hosting CMS server; a
        // browser-like fingerprint gets build machines through more reliably.
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'nl,en;q=0.8',
    };
}

function base(): string {
    return `${API_URL!.replace(/\/$/, '')}/v1/sites/${SITE_SLUG}`;
}

// Public submissions endpoint for browser-side form posts (no API key). Returns
// null when the site isn't configured (fixture/preview mode).
export function submissionsEndpoint(): string | null {
    if (!API_URL || !SITE_SLUG) {
        return null;
    }
    return `${base()}/submissions`;
}

// Public newsletter signup endpoint (double opt-in; no API key). Returns null
// when the site isn't configured (fixture/preview mode).
export function newsletterSubscribeEndpoint(): string | null {
    if (!API_URL || !SITE_SLUG) {
        return null;
    }
    return `${base()}/newsletter/subscribe`;
}

export interface BookingServiceItem {
    id: number;
    name: string;
    description: string | null;
    duration_minutes: number;
    price_cents: number | null;
}

export interface BookingCategoryItem {
    id: number;
    name: string;
    services: BookingServiceItem[];
}

// Public booking endpoints for the browser-side widget (no API key). Returns
// null when the site isn't configured (fixture/preview mode).
export function bookingEndpoints(): { availability: string; request: string } | null {
    if (!API_URL || !SITE_SLUG) {
        return null;
    }
    return {
        availability: `${base()}/booking/availability`,
        request: `${base()}/booking/requests`,
    };
}

// The service catalog is fetched at build time and rendered as real HTML, so
// the services are indexable content (SEO) instead of an empty JS container.
// Fixture/preview mode gets a small demo catalog.
export async function getBookingCatalog(): Promise<BookingCategoryItem[]> {
    const snapshot = await fetchSnapshot('booking-catalog.json', (body) => Array.isArray(body.categories));
    if (snapshot) {
        return snapshot.categories as BookingCategoryItem[];
    }

    if (!configured) {
        return [
            {
                id: 1,
                name: 'Behandelingen',
                services: [
                    { id: 1, name: 'Kennismaking', description: 'Vrijblijvend gesprek om je wensen door te nemen.', duration_minutes: 30, price_cents: null },
                    { id: 2, name: 'Behandeling', description: 'Volledige behandeling op maat.', duration_minutes: 60, price_cents: 6500 },
                ],
            },
        ];
    }

    const body = await fetchDeliveryJson(
        `${base()}/booking/catalog`,
        (candidate) => Array.isArray(candidate.categories),
    );

    return body.categories as BookingCategoryItem[];
}

// Zonder env-config bouwen we tegen de meegeleverde fixture, zodat de template
// los van een draaiende CMS te previewen is.
function fixtureDocuments(): DeliveryDocument[] {
    return sample.documents as DeliveryDocument[];
}

// Fetch Delivery API JSON with retries. Imunify360 on the shared-hosting server
// intermittently blocks datacenter IPs (like Cloudflare's build machines)
// with an HTTP 200 + an "Access denied by Imunify360 bot-protection" JSON body,
// which would otherwise kill the whole static build. Retries with a pause absorb
// that; the final error includes the actual response body so the build log shows
// what the API really returned.
async function fetchDeliveryJson(
    url: string,
    isValid: (body: Record<string, unknown>) => boolean,
    attempts = 5,
): Promise<Record<string, unknown>> {
    let detail = '';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (attempt > 1) {
            console.warn(`Delivery API retry ${attempt}/${attempts} for ${url} — previous attempt: ${detail}`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 10000));
        }

        let response: Response;
        try {
            response = await fetch(url, { headers: headers() });
        } catch (error) {
            detail = `fetch failed (${error instanceof Error ? error.message : String(error)})`;
            continue;
        }

        const text = await response.text();
        let body: Record<string, unknown> | null = null;
        try {
            body = JSON.parse(text) as Record<string, unknown>;
        } catch {
            // non-JSON body; falls through to the detail below
        }

        if (response.ok && body !== null && isValid(body)) {
            return body;
        }

        detail = `status ${response.status}, body: ${text.slice(0, 300)}`;
    }

    throw new Error(`Delivery API kept returning an unexpected response: ${detail}`);
}

export async function getAllDocuments(type = 'landing_page'): Promise<DeliveryDocument[]> {
    const snapshot = await snapshotDocuments();
    if (snapshot) {
        return snapshot.filter((doc) => doc.type === type);
    }

    if (!configured) {
        return fixtureDocuments().filter((doc) => doc.type === type);
    }

    const documents: DeliveryDocument[] = [];
    let page: number | null = 1;

    while (page) {
        const body = await fetchDeliveryJson(
            `${base()}/documents/by-type/${type}?per_page=100&page=${page}`,
            (candidate) => Array.isArray(candidate.results),
        );
        documents.push(...(body.results as DeliveryDocument[]));
        page = body.next_page as number | null;
    }

    return documents;
}

export async function getDocument(uid: string): Promise<DeliveryDocument | null> {
    const snapshot = await snapshotDocuments();
    if (snapshot) {
        return snapshot.find((doc) => doc.uid === uid) ?? null;
    }

    if (!configured) {
        return fixtureDocuments().find((doc) => doc.uid === uid) ?? null;
    }

    const response = await fetch(`${base()}/documents/${uid}`, { headers: headers() });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`Delivery API gaf ${response.status} voor "${uid}"`);
    }
    const body = await response.json();
    return body.data as DeliveryDocument;
}
