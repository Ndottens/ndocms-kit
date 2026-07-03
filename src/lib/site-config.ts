// Per-site SEO/brand config contract. Each site exports a `site` object of
// this shape from src/site.ts and passes it to the Base layout; it drives the
// canonical/OG/Twitter tags and the Organization/LocalBusiness JSON-LD.

export interface BusinessInfo {
    // Schema.org type — 'LocalBusiness' or a subtype that fits the client, e.g.
    // 'ProfessionalService', 'HealthClub', 'Physician', 'HairSalon'. Leave the
    // whole `business` block out for a site that isn't a local business.
    type: string;
    telephone?: string;
    email?: string;
    address?: { street?: string; postalCode?: string; city?: string; country?: string };
    geo?: { lat: number; lng: number };
    openingHours?: string[]; // schema.org text form, e.g. ['Mo-Fr 09:00-17:00', 'Sa 10:00-14:00']
    priceRange?: string; // e.g. '€€'
    sameAs?: string[]; // social / profile URLs
}

export interface SiteConfig {
    name: string;
    description: string; // default meta description + social fallback
    locale: string; // OG locale, e.g. 'nl_NL'
    logo?: string; // absolute path like '/logo.png' — used as the Organization logo
    business?: BusinessInfo;
}
