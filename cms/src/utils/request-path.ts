/**
 * The request path, percent-decoded and without a trailing slash, for comparing with a
 * page's own path. Null when the path is not valid percent-encoding.
 */
export function requestPath(url: URL): string | null {
	try {
		return decodeURIComponent(url.pathname).replace(/\/$/, "");
	} catch {
		return null;
	}
}
