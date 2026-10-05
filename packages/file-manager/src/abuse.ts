/** Public address for Hub reports, appeals, and DMCA. Overridable via env in apps. */
export const ABUSE_EMAIL = "abuse@pile-commander.app"

export function abuse_mailto(subject: string, body: string, email = ABUSE_EMAIL): string {
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
