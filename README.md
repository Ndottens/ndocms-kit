# ndocms-kit

Een klantsite bevat alleen nog **design** (tokens, fonts, `site.ts`, slice-componenten + registry,
fixtures); al het onderliggende komt uit deze kit:

| Import | Wat |
|---|---|
| `ndocms-kit/lib/delivery` | Content ophalen: R2-snapshots → fixture → Delivery API (fallback), `submissionsEndpoint()`, `bookingEndpoints()`, `getBookingCatalog()` |
| `ndocms-kit/lib/forms` | `setupForms()` — formulier-wiring (honeypot, Turnstile, statusmeldingen) |
| `ndocms-kit/lib/booking` | `setupBooking()` — boekingswizard (dienst → dag → slot → aanvraag) |
| `ndocms-kit/lib/turnstile` | Gedeelde Turnstile-helpers |
| `ndocms-kit/lib/richtext` | Structured-text helpers |
| `ndocms-kit/lib/types` | `DeliveryDocument`, `SliceInstance`, `RichTextNode`, `ImageValue` |
| `ndocms-kit/lib/site-config` | `SiteConfig`/`BusinessInfo` (contract voor `src/site.ts`) |
| `ndocms-kit/lib/design` | `DividerStyle` (contract voor `src/design.ts`) |
| `ndocms-kit/components/SliceZone.astro` | Slice-rendering: ritme, dividers, ankers — props `{ slices, registry, dividerStyle }` |
| `ndocms-kit/components/Img.astro` | Beeld met CLS-attributen, focuspunt, fit en beeldvorm |
| `ndocms-kit/components/RichText.astro` | Structured-text rendering |
| `ndocms-kit/components/Icon.astro` | Icon-catalogus (site mag lokaal shadowen) |
| `ndocms-kit/components/SectionDivider.astro` | Sectie-overgangen (gebruikt door SliceZone) |
| `ndocms-kit/layouts/Base.astro` | `<head>`/SEO/JSON-LD — props `{ site, title, … }` + named slot `head` voor fonts; wordt gewikkeld door de per-site `SiteLayout.astro` |

## Gebruik in een site

```jsonc
// package.json
"dependencies": { "ndocms-kit": "github:Ndottens/ndocms-kit#v1" }
```

```css
/* globale CSS — Tailwind v4 scant node_modules niet vanzelf */
@source "../../node_modules/ndocms-kit";
```

## Beelden: wat de editor per plek bepaalt

`Img.astro` leest drie dingen uit de `ImageValue` en de site hoeft er niks voor
te doen behalve het beeld via `Img` renderen:

- **Focuspunt** (`focalX`/`focalY`) → `object-position`, zodat een crop het
  belangrijkste deel in beeld houdt.
- **Fit** (`fit: 'contain'`) → volledig beeld, niet gecropt.
- **Vorm** (`shape`: `original`/`square`/`portrait`/`landscape`/`wide`/`circle`)
  → `aspect-ratio` (+ ronde hoeken bij `circle`), met de gereserveerde hoogte
  uit die verhouding zodat de vorm geen layout-shift kost.

De vorm werkt alleen als het beeld zich vrij mag opmeten. Zet géén vaste hoogte
of eigen `aspect-*`-class op de directe container van een `Img` die de keuze van
de editor moet volgen. Moet een plek altijd dezelfde vorm houden, beperk dat dan
in de veldconfig (`shapes`) in plaats van in de CSS.

## Updates & versies

- **Bron** is `packages/ndocms-kit/` in de NDOCMS-repo; deze repo is puur het
  distributiekanaal. Publiceren: `make kit-push` in de NDOCMS-root.
- Sites pinnen op branch **`v1`**. Cloudflare Pages-build-command is
  `npm update ndocms-kit && npm run build`, dus elke site pakt de laatste v1
  automatisch bij z'n volgende build. Lokaal: `npm update ndocms-kit`.
- **Breaking change?** Push naar een `v2`-branch en laat sites bewust
  overstappen. Een site tijdelijk bevriezen = de update-stap uit het
  Pages-build-command halen.
