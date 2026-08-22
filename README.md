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

Elke `<Img>` heeft een **verplichte `box`-prop**. Die zegt wie de verhouding van
het beeld bepaalt, en dat is altijd precies één partij:

| `box` | Wie bepaalt de vorm | Waarvoor |
|---|---|---|
| `"cms"` | de redacteur | vrije, redactionele beelden — alleen waar het veld `shapes` toestaat |
| `"fill"` | de slice | logo's, avatars, tegels, fotogrids, achtergronden |

Bij `box="cms"` rendert `Img` **zelf** de box: `aspect-ratio`, `overflow-hidden`,
en bij `circle` de radius — op een vlak dat gegarandeerd vierkant is. Je `class`
landt op die box, dus zet er geen eigen `aspect-*` of vaste hoogte omheen.

Bij `box="fill"` zet de slice de box en krijgt het beeld
`absolute inset-0 h-full w-full object-cover`. Een `shape` op de waarde wordt dan
bewust genegeerd, en `Img` logt daar in dev een waarschuwing over (geef
`field="slice.veldnaam"` mee zodat die bruikbaar is). Die waarschuwing betekent
dat het CMS een knop toont die het design niet uitvoert: repareer de veldconfig
of de slice, negeer hem niet.

Waarom het verplicht is: een slice die zijn eigen ratio zette terwijl de vorm nog
op de `<img>` stond, won de verhouding maar niet de afronding. Een volledige
radius op een 4:3-vlak is een **ellips**. Met `box` kan dat niet meer ontstaan.

Wat `Img` verder uit de `ImageValue` leest:

- **Focuspunt** (`focalX`/`focalY`) → `object-position`, zodat een uitsnede het
  belangrijkste deel in beeld houdt. Werkt in beide modi.
- **Fit** (`fit: 'contain'`) → **geen uitsnede**. Dit is geen object-fit-waarde:
  de box volgt de foto en een gekozen vorm vervalt. Letterboxen binnen een
  opgelegde vorm doet `Img` nooit — lege banden in een gekaderde box lezen als een
  dik kader, en een ingepaste foto achter een cirkelmasker als een ovale sliver.
- **Vorm** (`shape`: `original`/`square`/`portrait`/`landscape`/`wide`/`circle`)
  → de aspect-ratio van de box, met de gereserveerde hoogte uit die verhouding
  zodat de vorm geen layout-shift kost. Alleen bij `box="cms"` en zonder
  `fit: 'contain'`.

`width`/`height`, `srcset`/`sizes`, `loading` en `decoding` worden in beide modi
gezet — CLS blijft dus altijd gedekt.

## Updates & versies

- **Bron** is `packages/ndocms-kit/` in de NDOCMS-repo; deze repo is puur het
  distributiekanaal. Publiceren: `make kit-push` in de NDOCMS-root.
- Sites pinnen op branch **`v2`**. Het build-command van Workers Builds is
  `npm update ndocms-kit && npm run build`, dus elke site pakt de laatste v1
  automatisch bij z'n volgende build. Lokaal: `npm update ndocms-kit`.
- **Breaking change?** Push naar een `v2`-branch en laat sites bewust
  overstappen. Een site tijdelijk bevriezen = de update-stap uit het
  Pages-build-command halen.
