// Fixed system-text dictionary for the client sites. The content a client types
// is already in their own language; this only covers the strings baked into the
// code (form/booking feedback, form labels, blog chrome, date/number formats).
//
// Each site is single-language: resolve the language from SiteConfig.locale
// (`langFromLocale`) and pass it to `t`. Everything falls back to Dutch, so an
// unknown or missing locale keeps the existing Dutch sites byte-for-byte.
//
// Client-side modules (forms.ts, booking.ts) run in the browser and can't read
// the Astro build config, so the rendering component writes the resolved code
// into a `data-lang` attribute and the module reads it back through this helper.

export type Lang = 'nl' | 'en' | 'de';

const FALLBACK: Lang = 'nl';

const LANGS: readonly Lang[] = ['nl', 'en', 'de'];

// BCP-47 tag per language, for Intl date/number formatting.
const LOCALE_TAG: Record<Lang, string> = {
    nl: 'nl-NL',
    en: 'en-GB',
    de: 'de-DE',
};

// Monday-first weekday abbreviations for the booking calendar grid.
const WEEKDAYS: Record<Lang, readonly string[]> = {
    nl: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
};

type Dict = Record<string, string>;

const nl: Dict = {
    'field.name': 'Naam',
    'field.email': 'E-mailadres',
    'field.emailShort': 'E-mail',
    'field.phone': 'Telefoon',
    'field.message': 'Bericht',
    'field.note': 'Opmerking',
    'field.address': 'Adres',
    'field.optional': 'optioneel',
    'action.send': 'Versturen',
    'action.subscribe': 'Aanmelden',
    'action.backToTop': 'Terug naar boven',
    'form.notLinked': 'Formulier is nog niet gekoppeld.',
    'form.invalid': 'Controleer de ingevulde gegevens.',
    'form.throttled': 'Te veel pogingen. Probeer het over een minuut opnieuw.',
    'form.error': 'Er ging iets mis. Probeer het later opnieuw.',
    'form.errorShort': 'Er ging iets mis.',
    'form.offline': 'Geen verbinding. Probeer het later opnieuw.',
    'form.sending': 'Versturen…',
    'form.success': 'Bedankt, we hebben je bericht ontvangen.',
    'newsletter.success': 'Bijna klaar! Check je inbox om je aanmelding te bevestigen.',
    'booking.chooseTime': 'Kies een tijd',
    'booking.chooseOtherService': 'Andere dienst kiezen',
    'booking.chooseOtherTime': 'Ander moment kiezen',
    'booking.prevMonth': 'Vorige maand',
    'booking.nextMonth': 'Volgende maand',
    'booking.requestAppointment': 'Afspraak aanvragen',
    'booking.requestReceived': 'We hebben je aanvraag ontvangen.',
    'booking.confirmationNote': 'Je krijgt bericht zodra de afspraak is bevestigd.',
    'booking.noscript': 'Online boeken werkt alleen met JavaScript. Neem gerust contact met ons op om een afspraak te maken.',
    'booking.notLinked': 'Agenda is nog niet gekoppeld.',
    'booking.loading': 'Beschikbaarheid laden…',
    'booking.loadError': 'De agenda kon niet geladen worden. Probeer het later opnieuw.',
    'booking.conflict': 'Dit tijdstip is net geboekt. Kies een ander moment.',
    'nav.menu': 'Menu',
    'blog.title': 'Blog',
    'blog.readMore': 'Lees verder',
    'blog.allArticles': 'Alle artikelen',
    'blog.minRead': '{minutes} min lezen',
    'blog.empty': 'Er zijn nog geen artikelen.',
    'contact.mapTitle': 'Kaart: {address}',
};

const en: Dict = {
    'field.name': 'Name',
    'field.email': 'Email address',
    'field.emailShort': 'Email',
    'field.phone': 'Phone',
    'field.message': 'Message',
    'field.note': 'Comment',
    'field.address': 'Address',
    'field.optional': 'optional',
    'action.send': 'Send',
    'action.subscribe': 'Subscribe',
    'action.backToTop': 'Back to top',
    'form.notLinked': 'This form is not connected yet.',
    'form.invalid': 'Please check the details you entered.',
    'form.throttled': 'Too many attempts. Please try again in a minute.',
    'form.error': 'Something went wrong. Please try again later.',
    'form.errorShort': 'Something went wrong.',
    'form.offline': 'No connection. Please try again later.',
    'form.sending': 'Sending…',
    'form.success': 'Thanks, we have received your message.',
    'newsletter.success': "Almost done! Check your inbox to confirm your subscription.",
    'booking.chooseTime': 'Choose a time',
    'booking.chooseOtherService': 'Choose another service',
    'booking.chooseOtherTime': 'Choose another time',
    'booking.prevMonth': 'Previous month',
    'booking.nextMonth': 'Next month',
    'booking.requestAppointment': 'Request appointment',
    'booking.requestReceived': 'We have received your request.',
    'booking.confirmationNote': "You'll hear from us as soon as the appointment is confirmed.",
    'booking.noscript': 'Online booking only works with JavaScript enabled. Feel free to contact us to make an appointment.',
    'booking.notLinked': 'The calendar is not connected yet.',
    'booking.loading': 'Loading availability…',
    'booking.loadError': 'The calendar could not be loaded. Please try again later.',
    'booking.conflict': 'This time was just booked. Please pick another moment.',
    'nav.menu': 'Menu',
    'blog.title': 'Blog',
    'blog.readMore': 'Read more',
    'blog.allArticles': 'All articles',
    'blog.minRead': '{minutes} min read',
    'blog.empty': 'There are no articles yet.',
    'contact.mapTitle': 'Map: {address}',
};

const de: Dict = {
    'field.name': 'Name',
    'field.email': 'E-Mail-Adresse',
    'field.emailShort': 'E-Mail',
    'field.phone': 'Telefon',
    'field.message': 'Nachricht',
    'field.note': 'Anmerkung',
    'field.address': 'Adresse',
    'field.optional': 'optional',
    'action.send': 'Senden',
    'action.subscribe': 'Anmelden',
    'action.backToTop': 'Nach oben',
    'form.notLinked': 'Das Formular ist noch nicht verknüpft.',
    'form.invalid': 'Bitte überprüfe die eingegebenen Daten.',
    'form.throttled': 'Zu viele Versuche. Bitte versuche es in einer Minute erneut.',
    'form.error': 'Etwas ist schiefgelaufen. Bitte versuche es später erneut.',
    'form.errorShort': 'Etwas ist schiefgelaufen.',
    'form.offline': 'Keine Verbindung. Bitte versuche es später erneut.',
    'form.sending': 'Wird gesendet…',
    'form.success': 'Danke, wir haben deine Nachricht erhalten.',
    'newsletter.success': 'Fast geschafft! Bitte bestätige deine Anmeldung über den Link in deinem Postfach.',
    'booking.chooseTime': 'Zeit wählen',
    'booking.chooseOtherService': 'Anderen Service wählen',
    'booking.chooseOtherTime': 'Anderen Zeitpunkt wählen',
    'booking.prevMonth': 'Voriger Monat',
    'booking.nextMonth': 'Nächster Monat',
    'booking.requestAppointment': 'Termin anfragen',
    'booking.requestReceived': 'Wir haben deine Anfrage erhalten.',
    'booking.confirmationNote': 'Du erhältst eine Nachricht, sobald der Termin bestätigt ist.',
    'booking.noscript': 'Die Online-Buchung funktioniert nur mit aktiviertem JavaScript. Kontaktiere uns gerne, um einen Termin zu vereinbaren.',
    'booking.notLinked': 'Der Kalender ist noch nicht verknüpft.',
    'booking.loading': 'Verfügbarkeit wird geladen…',
    'booking.loadError': 'Der Kalender konnte nicht geladen werden. Bitte versuche es später erneut.',
    'booking.conflict': 'Dieser Zeitpunkt wurde gerade gebucht. Bitte wähle einen anderen.',
    'nav.menu': 'Menü',
    'blog.title': 'Blog',
    'blog.readMore': 'Weiterlesen',
    'blog.allArticles': 'Alle Artikel',
    'blog.minRead': '{minutes} Min. Lesezeit',
    'blog.empty': 'Es gibt noch keine Artikel.',
    'contact.mapTitle': 'Karte: {address}',
};

const DICT: Record<Lang, Dict> = { nl, en, de };

export function langFromLocale(locale: string | null | undefined): Lang {
    const code = (locale ?? '').split(/[_-]/)[0].toLowerCase();
    return (LANGS as readonly string[]).includes(code) ? (code as Lang) : FALLBACK;
}

export function localeTag(lang: Lang): string {
    return LOCALE_TAG[lang] ?? LOCALE_TAG[FALLBACK];
}

export function weekdays(lang: Lang): readonly string[] {
    return WEEKDAYS[lang] ?? WEEKDAYS[FALLBACK];
}

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
    const template = DICT[lang]?.[key] ?? DICT[FALLBACK][key] ?? key;
    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
