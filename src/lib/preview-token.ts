// Validates the short-lived render token the story editor sends with every
// POST to /_ndocms/render. The shared secret is NDOCMS_API_KEY — both sides
// already have it, so no extra configuration is needed. The CMS builds the
// token in app/Support/PreviewRenderToken.php as
// "<unix-expiry>.<hmac-1>,<hmac-2>,..." (one HMAC per active key, so key
// rotation keeps working).
//
// Without a configured api key (fixture/local mode) validation is skipped:
// there is no secret to check against, and nothing sensitive to protect.

export async function validatePreviewToken(token: string | null, apiKey: string | undefined): Promise<boolean> {
    if (!apiKey) return true;
    if (!token) return false;

    const [expiresRaw, hashesRaw] = token.split('.');
    const expires = Number(expiresRaw);
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;

    const expected = await hmacHex(apiKey, expiresRaw);
    return (hashesRaw ?? '').split(',').includes(expected);
}

async function hmacHex(key: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
