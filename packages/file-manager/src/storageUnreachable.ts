/**
 * Cloud storage could not be reached at all: the connection never opened or
 * dropped before storage answered. B2 is blocked in some countries without a
 * VPN, so the message names both causes. Nothing was stored, and the same
 * upload can simply be tried again; `cause` keeps the technical error.
 */
export class StorageUnreachableError extends Error {
	constructor(cause?: unknown) {
		super("Can't reach cloud storage. Check your connection or VPN and try again.")
		this.name = "StorageUnreachableError"
		if (cause !== undefined) this.cause = cause
	}
}
