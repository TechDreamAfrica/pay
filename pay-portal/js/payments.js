// ============================================================================
// Payments — calls the hubtel-initiate-payment / hubtel-check-status Edge
// Functions (never Hubtel directly) and reads payment history via RLS.
// ============================================================================
import { supabase } from './supabase.js';

export const STATUS_COLORS = {
  pending: 'bg-slate-100 text-slate-600',
  processing: 'bg-blue-100 text-blue-700',
  successful: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-400',
  refunded: 'bg-violet-100 text-violet-700',
};

export function statusLabel(status) {
  return (status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function statusBadge(status) {
  const cls = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600';
  return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cls}">${statusLabel(status)}</span>`;
}

export const PAYMENT_METHOD_LABEL = {
  mtn_momo: 'MTN Mobile Money',
  telecel_cash: 'Telecel Cash',
  airteltigo_money: 'AirtelTigo Money',
  visa: 'Visa',
  mastercard: 'Mastercard',
};

// Initiates a payment. `data` shape:
// { invoiceId?, purpose, fullName, email, phone, amount, currency, paymentMethod }
export async function initiatePayment(data) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data: result, error } = await supabase.functions.invoke('hubtel-initiate-payment', {
    body: data,
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) throw new Error(error.message || 'Could not start payment.');
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function checkPaymentStatus(clientReference) {
  const { data, error } = await supabase.functions.invoke('hubtel-check-status', {
    body: { clientReference },
  });
  if (error) throw new Error(error.message || 'Could not check payment status.');
  if (data?.error) throw new Error(data.error);
  return data;
}

// Polls checkPaymentStatus every `intervalMs` until a terminal status is
// reached or `timeoutMs` elapses. Calls onUpdate(status, payment) each tick.
export function pollPaymentStatus(clientReference, { onUpdate, intervalMs = 4000, timeoutMs = 120000 }) {
  const terminal = ['successful', 'failed', 'cancelled', 'refunded'];
  const start = Date.now();
  const timer = setInterval(async () => {
    try {
      const result = await checkPaymentStatus(clientReference);
      onUpdate?.(result.status, result.payment);
      if (terminal.includes(result.status) || Date.now() - start > timeoutMs) clearInterval(timer);
    } catch (err) {
      console.error('poll error', err);
      if (Date.now() - start > timeoutMs) clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export async function getPaymentByReference(clientReference) {
  const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number, project_name)')
    .eq('client_reference', clientReference).single();
  if (error) throw error;
  return data;
}

export async function getPaymentById(id) {
  const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number, project_name)').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getMyPayments() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number)').eq('client_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAllPayments() {
  const { data, error } = await supabase.from('payments').select('*, invoices(invoice_number)').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getReceiptForPayment(paymentId) {
  const { data, error } = await supabase.from('receipts').select('*').eq('payment_id', paymentId).single();
  if (error) return null;
  return data;
}
