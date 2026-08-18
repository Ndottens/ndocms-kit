// Shape primitives: static maps from a named shape to literal Tailwind
// classes. The kit is scanned by every project (`@source` in tokens.css), so
// classes written literally here survive purge. Never build class names
// dynamically from these keys — look them up: `bandRadius.tr`.
//
// These are mechanics, not aesthetics: which shape a project uses (and where)
// is a blueprint decision (projects/PATTERNS.md + the project's DESIGN.md).

// One giant rounded corner on a color band (the "band breaker"). clamp() keeps
// the corner proportional on small screens.
export const bandRadius = {
    tl: 'rounded-tl-[clamp(40px,9vw,140px)]',
    tr: 'rounded-tr-[clamp(40px,9vw,140px)]',
    bl: 'rounded-bl-[clamp(40px,9vw,140px)]',
    br: 'rounded-br-[clamp(40px,9vw,140px)]',
    'tl-br': 'rounded-tl-[clamp(40px,9vw,140px)] rounded-br-[clamp(40px,9vw,140px)]',
    'tr-bl': 'rounded-tr-[clamp(40px,9vw,140px)] rounded-bl-[clamp(40px,9vw,140px)]',
} as const;

export type BandRadius = keyof typeof bandRadius;

// Diagonal and notched cuts. Apply to a background LAYER (an absolutely
// positioned div behind the content), never to the section itself: content
// must stay inside the safe area, and a clipped section would also clip
// anything hanging over its boundary.
export const clip = {
    'slant-down': '[clip-path:polygon(0_0,100%_0,100%_calc(100%-clamp(24px,5vw,80px)),0_100%)]',
    'slant-up': '[clip-path:polygon(0_0,100%_0,100%_100%,0_calc(100%-clamp(24px,5vw,80px)))]',
    'slant-top-down': '[clip-path:polygon(0_0,100%_clamp(24px,5vw,80px),100%_100%,0_100%)]',
    'slant-top-up': '[clip-path:polygon(0_clamp(24px,5vw,80px),100%_0,100%_100%,0_100%)]',
    'notch-tr': '[clip-path:polygon(0_0,85%_0,100%_clamp(24px,5vw,80px),100%_100%,0_100%)]',
    'notch-bl': '[clip-path:polygon(0_0,100%_0,100%_100%,15%_100%,0_calc(100%-clamp(24px,5vw,80px)))]',
} as const;

export type ClipShape = keyof typeof clip;

// Mask starters live as SVG files, not classes: a mask needs a URL the project
// serves itself. Copy from the kit's assets/shapes/ into the project's
// public/shapes/, adjust to the brand, then apply on a box="fill" image:
//
//   <div class="relative aspect-[4/5] [mask-image:url(/shapes/blob-1.svg)]
//               [mask-size:100%_100%] [mask-repeat:no-repeat]">
//       <Img image={image} box="fill" class="absolute inset-0 h-full w-full object-cover" />
//   </div>
