import {
	getEmDashCollection,
	type CacheHint,
	type ContentEntry,
	type InferCollectionData,
} from "emdash";

export type ProjectEntry = ContentEntry<InferCollectionData<"projects">>;

/**
 * Published projects for the home page list, in `order` (not a sortable column, so the
 * sort happens here). A locale with no entries gives an empty list and the section is
 * left out. A database without the `projects` collection (one created before it was
 * added to the seed) also gives an empty list, so the home page never fails on it.
 */
export async function listPublishedProjects(
	locale: string,
): Promise<{ projects: ProjectEntry[]; cacheHint?: CacheHint }> {
	try {
		const { entries, cacheHint } = await getEmDashCollection("projects", {
			status: "published",
			locale,
			limit: 50,
		});
		const projects = [...entries].sort(
			(a, b) => (a.data.order ?? Number.MAX_SAFE_INTEGER) - (b.data.order ?? Number.MAX_SAFE_INTEGER),
		);
		return { projects, cacheHint };
	} catch (error) {
		console.warn("projects: collection not readable, home page list left out", error);
		return { projects: [] };
	}
}
