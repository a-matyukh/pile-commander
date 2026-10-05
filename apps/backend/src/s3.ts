import { S3Client } from "bun";
import type { Env } from "./env";

// Backblaze B2 speaks the S3-compatible API; Bun's native client handles
// signing, presigning and multipart — no AWS SDK involved
export function create_s3(env: Env): S3Client {
	return new S3Client({
		endpoint: env.b2_endpoint,
		region: env.b2_region,
		bucket: env.b2_bucket,
		accessKeyId: env.b2_key_id,
		secretAccessKey: env.b2_application_key,
	});
}
