// Node's default fetch fingerprint (bare UA, minimal headers) trips
// Imunify360's bot heuristics on the shared-hosting CMS server; a
// browser-like fingerprint gets build machines through more reliably.
export function deliveryHeaders(apiKey: string): HeadersInit {
    return {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'nl,en;q=0.8',
    };
}
