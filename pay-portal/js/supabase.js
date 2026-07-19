// ============================================================================
// Supabase Client — single source of truth for the connection.
// Replace the two constants below with your project's values
// (Supabase Dashboard → Project Settings → API).
// ============================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('users').select('*').eq('id', user.id).single();
  if (error) { console.error('getCurrentProfile error', error); return null; }
  return data;
}

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session;
}

export function dashboardUrlForRole(role) {
  return role === 'admin' || role === 'finance' ? 'dashboard.html?view=finance' : 'dashboard.html?view=client';
}
