import {
	getEmDashCollection,
	type CacheHint,
	type ContentEntry,
	type InferCollectionData,
} from "emdash";

export type TrackEntry = ContentEntry<InferCollectionData<"learn_tracks">>;

/**
 * Published track cards for /learn/, in `order` (the field is not a sortable
 * column, so the sort happens here). Finnish only; the catalogue has no English page.
 */
export async function listPublishedTracks(): Promise<{ tracks: TrackEntry[]; cacheHint: CacheHint }> {
	const { entries, cacheHint } = await getEmDashCollection("learn_tracks", {
		status: "published",
		locale: "fi",
		limit: 200,
	});
	const tracks = [...entries].sort(
		(a, b) => (a.data.order ?? Number.MAX_SAFE_INTEGER) - (b.data.order ?? Number.MAX_SAFE_INTEGER),
	);
	return { tracks, cacheHint };
}

/** Track slug, which is also its folder name under data/learn/. */
export function trackSlug(entry: TrackEntry): string {
	return entry.data.slug ?? entry.id;
}

/** URL of a track's front page, e.g. `/learn/ai-music/`. */
export function trackPath(slug: string): string {
	return `/learn/${slug}/`;
}
