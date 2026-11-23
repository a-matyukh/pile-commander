// Same shape as the database CHECKs on email columns: local-part @ domain
// with a dot. Trimmed and lowercased so lookups and unique keys are
// case-insensitive. Used by the feedback form and workspace invites
const EMAIL_RE = /^[^@]+@[^@]+\.[^@]+$/;

export function normalize_email(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const email = raw.trim().toLowerCase();
	if (!email || email.length > 254) return null;
	if (!EMAIL_RE.test(email)) return null;
	return email;
}

/** A hidden form field people never fill; bots do */
export function honeypot_filled(website: unknown): boolean {
	return typeof website === "string" && website.trim().length > 0;
}
