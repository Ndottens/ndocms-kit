// Browser-side form submission to the NdoCMS submissions endpoint.
//
// A slice component renders a `<form data-ndo-form data-form-type data-endpoint>`
// with the fields as `name`s, an empty honeypot `company`, an optional Turnstile
// widget and a `[data-form-status]` element for feedback. This wires all such
// forms on the page. Server-side the endpoint re-checks module entitlement,
// Turnstile, the honeypot and rate limiting, so this is purely UX.

import { langFromLocale, t, type Lang } from './i18n';
import { loadTurnstileOnInteraction, resetTurnstile, waitForTurnstileToken } from './turnstile';

interface SubmitResult {
    ok: boolean;
    error?: string;
}

async function post(
    endpoint: string,
    formType: string,
    payload: Record<string, string>,
    token: string | null,
    lang: Lang,
): Promise<SubmitResult> {
    if (!endpoint) {
        return { ok: false, error: t(lang, 'form.notLinked') };
    }
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ form_type: formType, payload, cf_turnstile_token: token }),
        });
        if (response.ok) {
            return { ok: true };
        }
        if (response.status === 422) {
            return { ok: false, error: t(lang, 'form.invalid') };
        }
        if (response.status === 429) {
            return { ok: false, error: t(lang, 'form.throttled') };
        }
        return { ok: false, error: t(lang, 'form.error') };
    } catch {
        return { ok: false, error: t(lang, 'form.offline') };
    }
}

function setStatus(el: HTMLElement | null, message: string, state: string): void {
    if (!el) {
        return;
    }
    el.textContent = message;
    el.dataset.state = state; // projects can style on [data-state=ok|error|pending]
}

export function setupForms(): void {
    const forms = document.querySelectorAll<HTMLFormElement>('[data-ndo-form]');
    forms.forEach((form) => {
        if (form.dataset.ndoWired) {
            return;
        }
        form.dataset.ndoWired = 'true';
        loadTurnstileOnInteraction(form);

        const lang = langFromLocale(form.dataset.lang);
        const endpoint = form.dataset.endpoint ?? '';
        const formType = form.dataset.formType ?? '';
        // Overridable per form: a newsletter signup says "check your inbox"
        // (double opt-in) instead of the generic thank-you.
        const successMessage = form.dataset.successMessage ?? t(lang, 'form.success');
        const status = form.querySelector<HTMLElement>('[data-form-status]');
        const button = form.querySelector<HTMLButtonElement>('button[type=submit]');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const data = new FormData(form);

            // Honeypot: a real user can't fill a hidden field. Pretend success so
            // a bot gets no signal; nothing is sent.
            if (String(data.get('company') ?? '') !== '') {
                form.reset();
                setStatus(status, successMessage, 'ok');
                return;
            }

            const payload: Record<string, string> = {};
            data.forEach((value, key) => {
                if (key === 'company' || key === 'cf-turnstile-response') {
                    return;
                }
                payload[key] = String(value);
            });

            if (button) {
                button.disabled = true;
            }
            setStatus(status, t(lang, 'form.sending'), 'pending');

            let token = (data.get('cf-turnstile-response') as string) || null;
            if (!token && form.querySelector('.cf-turnstile')) {
                token = await waitForTurnstileToken(form);
            }

            const result = await post(endpoint, formType, payload, token, lang);

            if (button) {
                button.disabled = false;
            }
            if (result.ok) {
                form.reset();
                setStatus(status, successMessage, 'ok');
                resetTurnstile();
            } else {
                setStatus(status, result.error ?? t(lang, 'form.errorShort'), 'error');
            }
        });
    });
}
