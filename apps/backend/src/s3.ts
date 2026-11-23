import { S3Client } from "bun";
import type { Env } from "./env";
import { create_s3_copy, type ObjectCopy } from "./s3_copy";

/**
 * Bun's S3 client plus a server-side copy it does not offer (s3_copy.ts):
 * finalize and fork re-keying copy inside the storage, with no bytes through
 * this process. Both speak the plain S3 API, so the store stays swappable
 */
export type Storage = S3Client & { copy: ObjectCopy };

// Backblaze B2 speaks the S3-compatible API; Bun's native client handles
// signing, presigning and multipart — no AWS SDK involved
export function create_s3(env: Env): Storage {
	const client = new S3Client({
		endpoint: env.b2_endpoint,
		region: env.b2_region,
		bucket: env.b2_bucket,
		accessKeyId: env.b2_key_id,
		secretAccessKey: env.b2_application_key,
	});
	return Object.assign(client, {
		copy: create_s3_copy({
			endpoint: env.b2_endpoint,
			region: env.b2_region,
			bucket: env.b2_bucket,
			access_key_id: env.b2_key_id,
			secret_access_key: env.b2_application_key,
		}),
	});
}
