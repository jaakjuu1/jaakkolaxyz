import type { APIContext, APIRoute } from "astro";
import { learnFileResponse, resolveLearnRequest } from "../../utils/learn-files";

// /learn/ itself is learn/index.astro (static routes win over this rest route).
export const prerender = false;

export const GET: APIRoute = (context) => serve(context, "GET");
export const HEAD: APIRoute = (context) => serve(context, "HEAD");

async function serve(context: APIContext, method: "GET" | "HEAD"): Promise<Response> {
	const outcome = await resolveLearnRequest(context.url);
	if (outcome.kind === "redirect") {
		return new Response(null, { status: 301, headers: { Location: outcome.location } });
	}
	if (outcome.kind === "file") {
		try {
			return await learnFileResponse(outcome.path, method, context.request);
		} catch {
			// Removed between the check and the read: answer as missing.
		}
	}
	return notFound(context);
}

/** The site's own Finnish 404 page, with a 404 status. */
async function notFound(context: APIContext): Promise<Response> {
	const page = await context.rewrite("/404");
	return new Response(page.body, { status: 404, headers: page.headers });
}
