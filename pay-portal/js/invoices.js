// ============================================================================
// Invoices — lookup (public RPC), authenticated listing, status helpers.
// ============================================================================
import { supabase } from './supabase.js';

export const STATUS_COLORS = {
  unpaid: 'bg-slate-100 text-slate-600',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-400',
};

export function statusLabel(status) {
  return (status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function statusBadge(status) {
  const cls = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600';
  return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cls}">${statusLabel(status)}</span>`;
}

// Public lookup used by "Pay using Invoice Number" — goes through the
// get_invoice_for_payment() SECURITY DEFINER RPC, not a direct table SELECT,
// so an unauthenticated visitor can't browse other people's invoices.
export async function lookupInvoice(invoiceNumber, email) {
  const { data, error } = await supabase.rpc('get_invoice_for_payment', {
    p_invoice_number: invoiceNumber.trim(),
    p_email: email.trim(),
  });
  if (error) throw error;
  if (!data || !data.length) throw new Error('No invoice found with that number and email.');
  return data[0];
}

// Authenticated client's own invoices (RLS-scoped).
export async function getMyInvoices() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('invoices').select('*').eq('client_id', user.id).order('due_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAllInvoices() {
  const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createInvoice(invoice) {
  const { data, error } = await supabase.from('invoices').insert({ ...invoice, balance: invoice.amount }).select().single();
  if (error) throw error;
  return data;
}
