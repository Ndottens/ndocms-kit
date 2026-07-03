// Browser-side form submission to the NdoCMS submissions endpoint.
//
// A slice component renders a `<form data-ndo-form data-form-type data-endpoint>`
// with the fields as `name`s, an empty honeypot `company`, an optional Turnstile
// widget and a `[data-form-status]` element for feedback. This wires all such
// forms on the page. Server-side the endpoint re-checks module entitlement,
// Turnstile, the honeypot and rate limiting, so this is purely UX.

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
): Promise<SubmitResult> {
    if (!endpoint) {
        return { ok: false, error: 'Formulier is nog niet gekoppeld.' };
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
            return { ok: false, error: 'Controleer de ingevulde gegevens.' };
        }
        if (response.status === 429) {
            return { ok: false, error: 'Te veel pogingen. Probeer het over een minuut opnieuw.' };
        }
        return { ok: false, error: 'Er ging iets mis. Probeer het later opnieuw.' };
    } catch {
        return { ok: false, error: 'Geen verbinding. Probeer het later opnieuw.' };
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

        const endpoint = form.dataset.endpoint ?? '';
        const formType = form.dataset.formType ?? '';
        const status = form.querySelector<HTMLElement>('[data-form-status]');
        const button = form.querySelector<HTMLButtonElement>('button[type=submit]');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const data = new FormData(form);

            // Honeypot: a real user can't fill a hidden field. Pretend success so
            // a bot gets no signal; nothing is sent.
            if (String(data.get('company') ?? '') !== '') {
                form.reset();
                setStatus(status, 'Bedankt, we hebben je bericht ontvangen.', 'ok');
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
            setStatus(status, 'Versturen…', 'pending');

            let token = (data.get('cf-turnstile-response') as string) || null;
            if (!token && form.querySelector('.cf-turnstile')) {
                token = await waitForTurnstileToken(form);
            }

            const result = await post(endpoint, formType, payload, token);

            if (button) {
                button.disabled = false;
            }
            if (result.ok) {
                form.reset();
                setStatus(status, 'Bedankt, we hebben je bericht ontvangen.', 'ok');
                resetTurnstile();
            } else {
                setStatus(status, result.error ?? 'Er ging iets mis.', 'error');
            }
        });
    });
}
