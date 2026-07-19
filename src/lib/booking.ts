// Browser-side booking wizard.
//
// BookingSection.astro renders the service catalog as static, indexable HTML
// (SEO) plus hidden step panels; this module progressively enhances it: pick a
// service → pick a day in a month grid → pick a time slot → contact details →
// submit a booking request. Availability is only fetched after a service is
// chosen, so the widget adds zero network cost to the page load. Server-side
// the endpoints re-check module entitlement, availability, Turnstile, the
// honeypot and rate limiting — everything here is purely UX.

import { langFromLocale, localeTag, t, weekdays, type Lang } from './i18n';
import { loadTurnstileOnInteraction, resetTurnstile, waitForTurnstileToken } from './turnstile';

interface Slot {
    start: string;
    end: string;
}

interface DayAvailability {
    date: string;
    slots: Slot[];
}

interface Availability {
    month: string;
    horizon: { from: string; to: string };
    days: DayAvailability[];
}

function monthOf(date: string): string {
    return date.slice(0, 7);
}

function todayIso(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(year, mon - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string, locale: string): string {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function dayLabel(date: string, locale: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

// Demo availability for fixture/preview mode (no endpoints configured):
// weekdays for the coming weeks, hourly slots during office hours.
function demoAvailability(month: string, duration: number): Availability {
    const from = todayIso();
    const to = new Date();
    to.setDate(to.getDate() + 28);
    const horizon = { from, to: to.toISOString().slice(0, 10) };

    const [year, mon] = month.split('-').map(Number);
    const days: DayAvailability[] = [];
    for (let day = new Date(year, mon - 1, 1); day.getMonth() === mon - 1; day.setDate(day.getDate() + 1)) {
        const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const weekday = day.getDay();
        const open = weekday !== 0 && weekday !== 6 && date > from && date <= horizon.to;
        const slots: Slot[] = [];
        if (open) {
            for (let hour = 9; hour + duration / 60 <= 17; hour += 1) {
                const end = hour + duration / 60;
                const endHours = Math.floor(end);
                const endMinutes = Math.round((end - endHours) * 60);
                slots.push({
                    start: `${String(hour).padStart(2, '0')}:00`,
                    end: `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`,
                });
            }
        }
        days.push({ date, slots });
    }

    return { month, horizon, days };
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

export function setupBooking(): void {
    document.querySelectorAll<HTMLElement>('[data-ndo-booking]').forEach((root) => {
        if (root.dataset.ndoWired) {
            return;
        }
        root.dataset.ndoWired = 'true';
        wire(root);
    });
}

function wire(root: HTMLElement): void {
    const lang: Lang = langFromLocale(root.dataset.lang);
    const locale = localeTag(lang);
    const availabilityEndpoint = root.dataset.availabilityEndpoint ?? '';
    const requestEndpoint = root.dataset.requestEndpoint ?? '';

    const catalog = root.querySelector<HTMLElement>('[data-booking-catalog]');
    const scheduleStep = root.querySelector<HTMLElement>('[data-booking-step="schedule"]');
    const detailsStep = root.querySelector<HTMLElement>('[data-booking-step="details"]');
    const successPanel = root.querySelector<HTMLElement>('[data-booking-success]');
    const serviceLabel = root.querySelector<HTMLElement>('[data-booking-service-label]');
    const monthLabelEl = root.querySelector<HTMLElement>('[data-booking-month-label]');
    const daysEl = root.querySelector<HTMLElement>('[data-booking-days]');
    const slotsEl = root.querySelector<HTMLElement>('[data-booking-slots]');
    const summaryEl = root.querySelector<HTMLElement>('[data-booking-summary]');
    const status = root.querySelector<HTMLElement>('[data-booking-status]');
    const form = root.querySelector<HTMLFormElement>('[data-booking-form]');
    const prevButton = root.querySelector<HTMLButtonElement>('[data-booking-prev]');
    const nextButton = root.querySelector<HTMLButtonElement>('[data-booking-next]');

    if (!catalog || !scheduleStep || !detailsStep || !daysEl || !slotsEl || !form) {
        return;
    }

    let service = { id: 0, name: '', duration: 60 };
    let month = monthOf(todayIso());
    let availability: Availability | null = null;
    let selectedDate = '';
    let selectedSlot: Slot | null = null;

    function setStatus(message: string, state: string): void {
        if (status) {
            status.textContent = message;
            status.dataset.state = state;
        }
    }

    function show(step: 'catalog' | 'schedule' | 'details' | 'success'): void {
        catalog!.hidden = step !== 'catalog';
        scheduleStep!.hidden = step !== 'schedule';
        detailsStep!.hidden = step !== 'details';
        if (successPanel) {
            successPanel.hidden = step !== 'success';
        }
        setStatus('', '');
    }

    async function fetchAvailability(): Promise<Availability | null> {
        if (!availabilityEndpoint) {
            return demoAvailability(month, service.duration);
        }
        try {
            const response = await fetch(`${availabilityEndpoint}?service_id=${service.id}&month=${month}`, {
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) {
                return null;
            }
            return (await response.json()) as Availability;
        } catch {
            return null;
        }
    }

    async function loadMonth(): Promise<void> {
        setStatus(t(lang, 'booking.loading'), 'pending');
        daysEl!.textContent = '';
        slotsEl!.textContent = '';
        selectedDate = '';
        availability = await fetchAvailability();
        if (!availability) {
            setStatus(t(lang, 'booking.loadError'), 'error');
            return;
        }
        setStatus('', '');
        renderMonth();
    }

    function renderMonth(): void {
        if (!availability) {
            return;
        }
        if (monthLabelEl) {
            monthLabelEl.textContent = monthLabel(month, locale);
        }
        if (prevButton) {
            prevButton.disabled = month <= monthOf(availability.horizon.from);
        }
        if (nextButton) {
            nextButton.disabled = month >= monthOf(availability.horizon.to);
        }

        daysEl!.textContent = '';
        slotsEl!.textContent = '';

        const grid = el('div', 'grid grid-cols-7 gap-1');
        weekdays(lang).forEach((label) => {
            grid.appendChild(el('span', 'py-1 text-center text-xs font-medium uppercase tracking-wide text-ink-muted', label));
        });

        const firstDate = new Date(`${availability.days[0]?.date ?? `${month}-01`}T00:00:00`);
        const offset = (firstDate.getDay() + 6) % 7; // Monday-first grid
        for (let i = 0; i < offset; i += 1) {
            grid.appendChild(el('span', ''));
        }

        availability.days.forEach((day) => {
            const dayNumber = String(Number(day.date.slice(8, 10)));
            if (day.slots.length === 0) {
                grid.appendChild(el('span', 'flex min-h-[44px] items-center justify-center rounded-lg text-sm text-ink/30', dayNumber));
                return;
            }
            const button = el('button', 'flex min-h-[44px] items-center justify-center rounded-lg border border-ink/15 bg-surface text-sm font-semibold text-ink transition hover:border-primary hover:text-primary', dayNumber);
            button.type = 'button';
            button.addEventListener('click', () => {
                selectedDate = day.date;
                grid.querySelectorAll('button').forEach((b) => {
                    b.classList.remove('bg-primary', 'text-ink-inverse', 'border-primary');
                    b.classList.add('bg-surface');
                });
                button.classList.remove('bg-surface');
                button.classList.add('bg-primary', 'text-ink-inverse', 'border-primary');
                renderSlots(day);
            });
            grid.appendChild(button);
        });

        daysEl!.appendChild(grid);
    }

    function renderSlots(day: DayAvailability): void {
        slotsEl!.textContent = '';
        slotsEl!.appendChild(el('p', 'text-sm font-medium text-ink', dayLabel(day.date, locale)));
        const list = el('div', 'mt-2 flex flex-wrap gap-2');
        day.slots.forEach((slot) => {
            const button = el('button', 'min-h-[44px] rounded-lg border border-ink/15 bg-surface px-4 text-sm font-semibold tabular-nums text-ink transition hover:border-primary hover:text-primary', slot.start);
            button.type = 'button';
            button.addEventListener('click', () => {
                selectedSlot = slot;
                if (summaryEl) {
                    summaryEl.textContent = `${service.name} — ${dayLabel(day.date, locale)}, ${slot.start}–${slot.end}`;
                }
                show('details');
            });
            list.appendChild(button);
        });
        slotsEl!.appendChild(list);
    }

    catalog.querySelectorAll<HTMLButtonElement>('[data-booking-service]').forEach((button) => {
        button.addEventListener('click', () => {
            service = {
                id: Number(button.dataset.serviceId ?? 0),
                name: button.dataset.serviceName ?? '',
                duration: Number(button.dataset.serviceDuration ?? 60),
            };
            if (serviceLabel) {
                serviceLabel.textContent = `${service.name} (${service.duration} min)`;
            }
            month = monthOf(todayIso());
            show('schedule');
            void loadMonth();
        });
    });

    root.querySelectorAll<HTMLButtonElement>('[data-booking-back-to-catalog]').forEach((button) => {
        button.addEventListener('click', () => show('catalog'));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-booking-back-to-schedule]').forEach((button) => {
        button.addEventListener('click', () => show('schedule'));
    });

    prevButton?.addEventListener('click', () => {
        month = shiftMonth(month, -1);
        void loadMonth();
    });
    nextButton?.addEventListener('click', () => {
        month = shiftMonth(month, 1);
        void loadMonth();
    });

    loadTurnstileOnInteraction(form);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selectedSlot || !selectedDate) {
            return;
        }

        const data = new FormData(form);

        // Honeypot: a real user can't fill a hidden field. Pretend success so
        // a bot gets no signal; nothing is sent.
        if (String(data.get('company') ?? '') !== '') {
            show('success');
            return;
        }

        if (!requestEndpoint) {
            setStatus(t(lang, 'booking.notLinked'), 'error');
            return;
        }

        const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
        if (button) {
            button.disabled = true;
        }
        setStatus(t(lang, 'form.sending'), 'pending');

        let token = (data.get('cf-turnstile-response') as string) || null;
        if (!token && form.querySelector('.cf-turnstile')) {
            token = await waitForTurnstileToken(form);
        }

        let outcome = '';
        try {
            const response = await fetch(requestEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    service_id: service.id,
                    date: selectedDate,
                    start: selectedSlot.start,
                    name: String(data.get('name') ?? ''),
                    email: String(data.get('email') ?? ''),
                    phone: String(data.get('phone') ?? '') || null,
                    message: String(data.get('message') ?? '') || null,
                    cf_turnstile_token: token,
                }),
            });
            if (response.ok) {
                outcome = 'ok';
            } else if (response.status === 409) {
                outcome = 'conflict';
            } else if (response.status === 422) {
                outcome = 'invalid';
            } else if (response.status === 429) {
                outcome = 'throttled';
            } else {
                outcome = 'error';
            }
        } catch {
            outcome = 'offline';
        }

        if (button) {
            button.disabled = false;
        }

        if (outcome === 'ok') {
            form.reset();
            resetTurnstile();
            show('success');
            return;
        }
        if (outcome === 'conflict') {
            show('schedule');
            setStatus(t(lang, 'booking.conflict'), 'error');
            void loadMonth();
            return;
        }
        const messages: Record<string, string> = {
            invalid: t(lang, 'form.invalid'),
            throttled: t(lang, 'form.throttled'),
            error: t(lang, 'form.error'),
            offline: t(lang, 'form.offline'),
        };
        setStatus(messages[outcome] ?? messages.error, 'error');
    });
}
