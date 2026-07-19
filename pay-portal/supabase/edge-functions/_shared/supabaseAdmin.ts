// ============================================================================
// Service-role Supabase client — used ONLY inside Edge Functions (never
// shipped to the browser). Bypasses RLS by design so functions can write
// authoritative payment/invoice state after verifying with Hubtel.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
