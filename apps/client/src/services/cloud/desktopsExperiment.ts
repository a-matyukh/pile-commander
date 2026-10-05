import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Records (once) that this account turned the desktops experiment on —
 * profiles.desktops_opt_in_at, read only by the admin report
 * desktops_experiment_report(). No event log: the rest of the report comes
 * from the cloud desktops the account already has.
 */
export async function mark_desktops_opt_in(client: SupabaseClient): Promise<void> {
	const { error } = await client.rpc('mark_desktops_opt_in')
	if (error) throw new Error(`mark_desktops_opt_in failed: ${error.message}`)
}
