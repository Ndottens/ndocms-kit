// Per-project design choices the shared SliceZone mechanics need. The
// mechanics (rhythm, dividers, anchors, the <main> landmark) live in the kit;
// which sections are dark and which belong to the site as a whole is design,
// and lives in each project's src/design.ts.

import type { SliceInstance } from './types';

// Shape of the transition between two sections with different backgrounds.
// Each site picks its own value in src/design.ts (see the project's DESIGN.md);
// the SliceZone places the divider automatically.
export type DividerStyle = 'none' | 'line' | 'angle' | 'curve' | 'wave' | 'wave-organic';

// A one-off divider shape for a single transition, returned by
// SectionPlan.dividerFor. The path is drawn in the given viewBox and filled
// with the color of the section below. heightClass must be a literal Tailwind
// class in the project's design.ts (the project is scanned, so it survives
// purge); it defaults to the standard divider height.
export interface CustomDivider {
    path: string;
    viewBox?: string;
    heightClass?: string;
}

// 'brand' (the project's brand color as a section background) never joins the
// automatic light/muted rhythm; it is only reachable through surfaceFor. It
// requires the --color-surface-brand and --color-ink-brand tokens.
export type Surface = 'light' | 'muted' | 'dark' | 'brand';

/**
 * Which sections belong to the site as a whole (navigation, footer, and
 * whatever gets added later) rather than to this one page? Decides where the
 * <main> landmark starts and ends.
 */
export type ChromePredicate = (slice: SliceInstance) => boolean;

/**
 * Which sections sit on a fixed background instead of joining the light/muted
 * rhythm? Return null to let a section alternate.
 */
export type SurfaceResolver = (slice: SliceInstance) => Surface | null;

export interface SectionPlan {
    chrome?: ChromePredicate;
    surfaceFor?: SurfaceResolver;
    /**
     * Per-transition divider override: return a DividerStyle or a CustomDivider
     * for the transition INTO `next`, or null to fall back to the site-wide
     * dividerStyle. Lets one transition be organic while the rest stay quiet.
     */
    dividerFor?: (from: Surface, to: Surface, next: SliceInstance) => DividerStyle | CustomDivider | null;
}

/**
 * Default: the CMS stamps `chrome` on slices belonging to a singleton custom
 * type, so a new singleton works without adding a name anywhere.
 */
export const isChrome: ChromePredicate = (slice) => slice.chrome === true;

/** Default: chrome is dark, everything else alternates light/muted. */
export const chromeIsDark: SurfaceResolver = (slice) => (isChrome(slice) ? 'dark' : null);

/**
 * Split a list into the chrome above, the content, and the chrome below — the
 * same boundary SliceZone uses for <main>. Routes without a document of their
 * own (blog index, 404) borrow the homepage's chrome this way, without knowing
 * any slice names.
 */
export function splitChrome<T>(
    rows: T[],
    sliceOf: (row: T) => SliceInstance,
    chrome: ChromePredicate = isChrome,
): { before: T[]; content: T[]; after: T[] } {
    const contentIndexes = rows.map((row, i) => (chrome(sliceOf(row)) ? -1 : i)).filter((i) => i !== -1);

    // No content at all (a 404 shell, a chrome-only preview): treat everything
    // as leading chrome so no empty <main> is emitted.
    if (contentIndexes.length === 0) {
        return { before: rows, content: [], after: [] };
    }

    const first = contentIndexes[0];
    const last = contentIndexes[contentIndexes.length - 1];

    return { before: rows.slice(0, first), content: rows.slice(first, last + 1), after: rows.slice(last + 1) };
}
