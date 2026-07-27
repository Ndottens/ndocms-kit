// Vorm van een document zoals de NdoCMS Delivery API het teruggeeft.
export interface DeliveryDocument {
    id: number;
    uid: string;
    type: string;
    is_homepage?: boolean;
    tags: string[];
    lang: string;
    first_publication_date: string | null;
    last_publication_date: string | null;
    data: DocumentData;
}

export interface DocumentData {
    slices?: SliceInstance[];
    seo?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface SliceInstance {
    id: string;
    sliceType: string;
    variation: string;
    primary: Record<string, unknown>;
    items: Record<string, unknown>[];
    // Set by the CMS on sections belonging to a singleton custom type
    // (navigation, footer, and whatever gets added later). Drives the <main>
    // boundary and the default surface, so no slice names are hardcoded.
    chrome?: boolean;
}

// Prismic-achtige structured text (TipTap-nodes) zoals het rich_text-veld die opslaat.
export interface RichTextNode {
    type: string;
    text?: string;
    marks?: { type: string; attrs?: Record<string, unknown> }[];
    attrs?: Record<string, unknown>;
    content?: RichTextNode[];
}

export interface ImageValue {
    url: string;
    alt?: string;
    width?: number | null;
    height?: number | null;
    variants?: ImageVariant[];
    focalX?: number | null;
    focalY?: number | null;
    fit?: 'cover' | 'contain' | null;
}

export interface ImageVariant {
    url: string;
    width: number;
}
