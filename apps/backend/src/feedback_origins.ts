// Who may POST /feedback from a browser. The rest of the API keeps CORS `*`
// (it is Bearer-authenticated); the feedback form is public, so it answers
// only the site and the desktop app. A script can still send any Origin:
// this stops other web pages, the IP rate limit and the honeypot stop the rest.

/** The site (landing and web app share the domain) and the Tauri webviews */
export const FEEDBACK_ORIGINS_DEFAULT: readonly string[] = [
	"https://pile-commander.app",
	"https://www.pile-commander.app",
	// Tauri on macOS and Linux
	"tauri://localhost",
	// Tauri on Windows
	"http://tauri.localhost",
];

function normalize_origin(raw: string): string {
	return raw.trim().toLowerCase().replace(/\/+$/, "");
}

/** FEEDBACK_ORIGINS, comma separated, replaces the default list */
export function parse_feedback_origins(raw: string | undefined): string[] {
	const list = (raw ?? "").split(",").map(normalize_origin).filter(Boolean);
	return list.length > 0 ? list : [...FEEDBACK_ORIGINS_DEFAULT];
}

export function feedback_origin_allowed(origin: string | null, allowed: readonly string[]): boolean {
	if (!origin) return false;
	return allowed.includes(normalize_origin(origin));
}

/**
 * CORS headers for /feedback: the allowed origin echoed back, never `*`.
 * A refused origin gets no Allow-Origin, so the browser blocks the response
 */
export function feedback_cors_headers(
	origin: string | null,
	allowed: readonly string[],
): Record<string, string> {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Expose-Headers": "Retry-After",
		Vary: "Origin",
	};
	if (origin && feedback_origin_allowed(origin, allowed)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}
