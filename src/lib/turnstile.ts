// Shared Cloudflare Turnstile helpers, used by both the forms (forms.ts) and
// the booking widget (booking.ts).

// Load the Turnstile script once per page, no matter how many widgets render
// (inline <script> tags per component would load it multiple times).
export function ensureTurnstileScript(): void {
    if (!document.querySelector('.cf-turnstile')) {
        return;
    }
    if (document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile"]')) {
        return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// Turnstile tokens expire after ~5 minutes and the widget then refreshes itself,
// spamming the console with challenge chatter on long-open pages. So the script
// only loads once a visitor actually touches the form.
export function loadTurnstileOnInteraction(form: HTMLFormElement): void {
    if (!form.querySelector('.cf-turnstile')) {
        return;
    }
    const load = () => ensureTurnstileScript();
    form.addEventListener('focusin', load, { once: true });
    form.addEventListener('pointerdown', load, { once: true });
}

// A very fast visitor can submit before the lazily-loaded widget has produced a
// token; give it a few seconds to arrive instead of failing the submission.
export async function waitForTurnstileToken(form: HTMLFormElement): Promise<string | null> {
    ensureTurnstileScript();
    for (let i = 0; i < 25; i += 1) {
        const value = String(new FormData(form).get('cf-turnstile-response') ?? '');
        if (value !== '') {
            return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}

export function resetTurnstile(): void {
    const turnstile = (window as unknown as { turnstile?: { reset: () => void } }).turnstile;
    turnstile?.reset();
}
