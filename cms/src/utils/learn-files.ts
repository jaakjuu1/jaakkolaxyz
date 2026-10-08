/**
 * Static learning tracks served from LEARN_DIR (data/learn/) at /learn/...
 *
 * Files are read at request time, never copied at build time, so a track that
 * Hermes rsyncs into data/learn/ is served without a rebuild or a restart.
 * Pages are returned byte for byte; no layout is applied.
 */
import type { Stats } from "node:fs";
import { open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname, join, relative, resolve, sep } from "node:path";

export const LEARN_URL_PREFIX = "/learn/";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".pdf": "application/pdf",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2",
};

export type LearnOutcome =
	| { kind: "file"; path: string }
	| { kind: "redirect"; location: string }
	| { kind: "missing" };

const MISSING: LearnOutcome = { kind: "missing" };

/**
 * Directory the tracks are served from. LEARN_DIR overrides it; the default
 * assumes the dev server runs in cms/. Read per call, so a changed value applies
 * without a restart.
 */
export function learnDir(): string {
	const configured = process.env.LEARN_DIR?.trim();
	return configured ? resolve(configured) : resolve(process.cwd(), "../data/learn");
}

/**
 * Entries that are never served or listed: dot-files and dot-directories
 * (.backups, .git) and the stray output of a mis-targeted publish.
 */
export function isHiddenSegment(name: string): boolean {
	return name.startsWith(".") || name.startsWith("teach-manual-publish-");
}

function isInside(root: string, path: string): boolean {
	const prefix = root.endsWith(sep) ? root : root + sep;
	return path.startsWith(prefix);
}

async function realRoot(): Promise<string | null> {
	try {
		return await realpath(learnDir());
	} catch {
		return null;
	}
}

/**
 * The real location of a path under root, or null. Symlinks are followed only
 * when the target stays inside root and is not a hidden entry.
 */
async function realInside(root: string, candidate: string): Promise<{ path: string; stats: Stats } | null> {
	if (!isInside(root, candidate)) return null;
	try {
		const real = await realpath(candidate);
		if (!isInside(root, real)) return null;
		if (relative(root, real).split(sep).some(isHiddenSegment)) return null;
		return { path: real, stats: await stat(real) };
	} catch {
		return null;
	}
}

/**
 * Maps the request URL to a file, a redirect or nothing. The path is decoded
 * exactly once; decoded NUL bytes, backslashes, `.`/`..` segments and hidden
 * entries are refused before anything touches the disk.
 */
export async function resolveLearnRequest(url: URL): Promise<LearnOutcome> {
	if (!url.pathname.startsWith(LEARN_URL_PREFIX)) return MISSING;

	let decoded: string;
	try {
		decoded = decodeURIComponent(url.pathname.slice(LEARN_URL_PREFIX.length));
	} catch {
		return MISSING;
	}
	if (decoded.includes("\0") || decoded.includes("\\")) return MISSING;

	const trailingSlash = decoded.endsWith("/");
	const body = trailingSlash ? decoded.slice(0, -1) : decoded;
	const segments = body.split("/");
	if (segments.some((s) => s === "" || s === "." || s === ".." || isHiddenSegment(s))) return MISSING;

	// The old catalogue page is no longer served; /learn/ is the Astro index page.
	if (body === "index.html") return { kind: "redirect", location: LEARN_URL_PREFIX };

	const root = await realRoot();
	if (!root) return MISSING;

	const found = await realInside(root, resolve(root, ...segments));
	if (!found) return MISSING;

	if (found.stats.isDirectory()) {
		if (!trailingSlash) return { kind: "redirect", location: `${url.pathname}/${url.search}` };
		const index = await realInside(root, join(found.path, "index.html"));
		return index?.stats.isFile() ? { kind: "file", path: index.path } : MISSING;
	}
	if (found.stats.isFile() && !trailingSlash) return { kind: "file", path: found.path };
	return MISSING;
}

/** Validator and range support for one file, from its stat. */
interface FileValidators {
	etag: string;
	lastModified: string;
	mtimeSeconds: number;
}

function validatorsFor(info: Stats): FileValidators {
	return {
		// Weak ETag from size and mtime: cheap, and enough to tell a re-rsynced file apart.
		etag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
		lastModified: info.mtime.toUTCString(),
		mtimeSeconds: Math.floor(info.mtimeMs / 1000),
	};
}

/** If-None-Match: weak comparison against the list of tags (or `*`). */
function etagMatches(header: string, etag: string): boolean {
	const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
	if (header.trim() === "*") return true;
	return header.split(",").some((tag) => opaque(tag) === opaque(etag));
}

/** Whether a conditional GET or HEAD can be answered with 304. */
function notModified(request: Request, validators: FileValidators): boolean {
	const ifNoneMatch = request.headers.get("if-none-match");
	if (ifNoneMatch !== null) return etagMatches(ifNoneMatch, validators.etag);
	const ifModifiedSince = request.headers.get("if-modified-since");
	const since = ifModifiedSince ? Date.parse(ifModifiedSince) : Number.NaN;
	return !Number.isNaN(since) && validators.mtimeSeconds <= Math.floor(since / 1000);
}

type ByteRange = { start: number; end: number };

/**
 * The single byte range a request asks for. Null means "send the whole file" (no
 * Range header, a form this server does not honour, or If-Range does not match);
 * "unsatisfiable" answers 416.
 */
function requestedRange(request: Request, size: number, validators: FileValidators): ByteRange | "unsatisfiable" | null {
	const header = request.headers.get("range");
	if (!header || !header.startsWith("bytes=") || header.includes(",")) return null;

	// Our ETag is weak, so If-Range can only match a Last-Modified date.
	const ifRange = request.headers.get("if-range");
	if (ifRange !== null && ifRange !== validators.lastModified) return null;

	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (match[1] === "" && match[2] === "")) return null;
	if (match[1] === "") {
		// Suffix range: the last N bytes.
		const suffix = Number(match[2]);
		if (suffix === 0 || size === 0) return "unsatisfiable";
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(match[1]);
	if (start >= size) return "unsatisfiable";
	const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
	if (end < start) return null;
	return { start, end };
}

/**
 * The file's bytes with its content type, validators and byte ranges. GET streams
 * the file; HEAD sends the same headers without a body. A conditional request gets
 * 304 and a Range gets 206 (or 416 when unsatisfiable).
 */
export async function learnFileResponse(path: string, method: "GET" | "HEAD", request: Request): Promise<Response> {
	// Open first and take the size from the handle, so a file that rsync removes or
	// replaces after the path check fails here (a 404 upstream), not mid-stream.
	const file = await open(path, "r");
	let streaming = false;
	try {
		const response = await respondFrom(file, path, method, request);
		streaming = response.body !== null;
		return response;
	} finally {
		if (!streaming) await file.close();
	}
}

async function respondFrom(
	file: FileHandle,
	path: string,
	method: "GET" | "HEAD",
	request: Request,
): Promise<Response> {
	const info = await file.stat();
	const validators = validatorsFor(info);
	const ext = extname(path).toLowerCase();
	const headers: Record<string, string> = {
		"Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
		// Revalidate every time: validators make that cheap, and a re-rsynced file shows up at once.
		"Cache-Control": "public, max-age=0, must-revalidate",
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		ETag: validators.etag,
		"Last-Modified": validators.lastModified,
	};

	if (notModified(request, validators)) {
		const { "Content-Type": _type, ...notModifiedHeaders } = headers;
		return new Response(null, { status: 304, headers: notModifiedHeaders });
	}

	const range = requestedRange(request, info.size, validators);
	if (range === "unsatisfiable") {
		return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}`, "Accept-Ranges": "bytes" } });
	}
	const start = range?.start ?? 0;
	const end = range?.end ?? info.size - 1;
	const length = info.size === 0 ? 0 : end - start + 1;
	const status = range ? 206 : 200;
	if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
	headers["Content-Length"] = String(length);

	if (method === "HEAD" || info.size === 0) {
		return new Response(null, { status, headers });
	}
	const stream = file.createReadStream(range ? { start, end } : {});
	return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers });
}

/**
 * Every public HTML page under LEARN_DIR as a URL path (`/learn/...`), walked at
 * request time with the same exclusions. A track folder's index.html is listed as
 * the folder URL. Symlinks are not followed. The root index.html is left out
 * because it redirects to /learn/.
 */
export async function listLearnHtmlPaths(): Promise<string[]> {
	const root = await realRoot();
	if (!root) return [];
	const paths: string[] = [];

	async function walk(dir: string, segments: string[]): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (isHiddenSegment(entry.name)) continue;
			if (entry.isDirectory()) {
				await walk(join(dir, entry.name), [...segments, entry.name]);
			} else if (entry.isFile() && entry.name.endsWith(".html")) {
				if (segments.length === 0 && entry.name === "index.html") continue;
				if (entry.name === "index.html") {
					paths.push(`${LEARN_URL_PREFIX}${segments.map(encodeURIComponent).join("/")}/`);
				} else {
					paths.push(`${LEARN_URL_PREFIX}${[...segments, entry.name].map(encodeURIComponent).join("/")}`);
				}
			}
		}
	}

	await walk(root, []);
	return paths.sort();
}
