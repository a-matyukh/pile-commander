// Erase every feedback note sent from one address, with its screenshots: the
// answer to "please delete what I wrote to you". Deleting an account does
// this by itself for the account's address.
//
//   bun --filter @pile-commander/backend erase:feedback someone@example.com
//
// Reads apps/backend/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Prints
// how many notes went; nothing else is touched.
import { service_client } from "../src/auth";
import { normalize_email } from "../src/emails";
import { load_env } from "../src/env";
import { default_erase, erase_feedback_of } from "../src/feedback";

const email = normalize_email(process.argv[2]);
if (!email) {
	console.error("usage: bun scripts/erase-feedback.ts <email>");
	process.exit(2);
}
const env = load_env();
if (!env.supabase_service_role_key) {
	console.error("SUPABASE_SERVICE_ROLE_KEY is not set: nothing can be erased");
	process.exit(1);
}
const erased = await erase_feedback_of(email, default_erase(service_client(env)));
console.log(erased === 0 ? "no notes from this address" : `erased ${erased} note(s)`);
