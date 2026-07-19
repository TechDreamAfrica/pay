// ============================================================================
// Dashboard — client + finance/admin stats, tables, activity.
// ============================================================================
import { supabase } from './supabase.js';
import { getMyInvoices } from './invoices.js';
import { getMyPayments, getAllPayments, statusBadge as paymentBadge } from './payments.js';
import { statusBadge as invoiceBadge } from './invoices.js';
import { skeletonRows, emptyState, timeAgo, formatMoney } from './ui.js';

export async function renderClientDashboard({ statsRow, invoicesList, paymentsList }) {
  const [invoices, payments] = await Promise.all([getMyInvoices(), getMyPayments()]);

  const totalPaid = payments.filter(p => p.status === 'successful').reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + Number(i.balance), 0);
  const pending = payments.filter(p => ['pending', 'processing'].includes(p.status)).length;
  const lastPayment = payments.find(p => p.status === 'successful');

  statsRow.innerHTML = [
    { label: 'Total Paid', value: formatMoney(totalPaid), icon: '💰' },
    { label: 'Outstanding Balance', value: formatMoney(outstanding), icon: '📋' },
    { label: 'Pending Payments', value: pending, icon: '⏳' },
    { label: 'Last Payment', value: lastPayment ? timeAgo(lastPayment.created_at) : '—', icon: '🕓' },
  ].map(s => `
    <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div class="flex items-center justify-between"><p class="text-sm text-slate-500 dark:text-slate-400">${s.label}</p><span class="text-lg">${s.icon}</span></div>
      <p class="mt-2 text-2xl font-semibold text-slate-800 dark:text-slate-100">${s.value}</p>
    </div>`).join('');

  invoicesList.innerHTML = invoices.length ? invoices.map(i => `
    <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${i.invoice_number} — ${i.project_name || i.description || 'Invoice'}</p>
        <p class="text-xs text-slate-400 mt-0.5">${formatMoney(i.balance, i.currency)} due ${i.due_date ? new Date(i.due_date).toLocaleDateString() : '—'}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${invoiceBadge(i.status)}
        ${i.status !== 'paid' && i.status !== 'cancelled' ? `<a href="pay.html?invoice=${i.invoice_number}&email=${encodeURIComponent(i.client_email)}" class="text-xs font-medium text-primary-600 hover:underline">Pay</a>` : ''}
      </div>
    </div>`).join('') : emptyState({ icon: '📋', title: 'No invoices yet' });

  paymentsList.innerHTML = payments.length ? payments.slice(0, 8).map(p => `
    <div class="flex items-center justify-between gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${formatMoney(p.amount, p.currency)} — ${p.purpose || 'Payment'}</p>
        <p class="text-xs text-slate-400">${timeAgo(p.created_at)}</p>
      </div>
      ${paymentBadge(p.status)}
    </div>`).join('') : '<p class="text-sm text-slate-400 text-center py-8">No payments yet.</p>';
}

export async function renderFinanceDashboard({ statsRow, tableBody }) {
  const payments = await getAllPayments();
  const today = new Date().toDateString();
  const thisMonth = new Date().getMonth();

  const todayRevenue = payments.filter(p => p.status === 'successful' && new Date(p.created_at).toDateString() === today).reduce((s, p) => s + Number(p.amount), 0);
  const monthRevenue = payments.filter(p => p.status === 'successful' && new Date(p.created_at).getMonth() === thisMonth).reduce((s, p) => s + Number(p.amount), 0);
  const pendingCount = payments.filter(p => ['pending', 'processing'].includes(p.status)).length;
  const successCount = payments.filter(p => p.status === 'successful').length;
  const failedCount = payments.filter(p => p.status === 'failed').length;

  statsRow.innerHTML = [
    { label: "Today's Revenue", value: formatMoney(todayRevenue), icon: '📈' },
    { label: 'Monthly Revenue', value: formatMoney(monthRevenue), icon: '💵' },
    { label: 'Pending Payments', value: pendingCount, icon: '⏳' },
    { label: 'Successful', value: successCount, icon: '✅' },
    { label: 'Failed', value: failedCount, icon: '⚠️' },
  ].map(s => `
    <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div class="flex items-center justify-between"><p class="text-sm text-slate-500 dark:text-slate-400">${s.label}</p><span class="text-lg">${s.icon}</span></div>
      <p class="mt-2 text-2xl font-semibold text-slate-800 dark:text-slate-100">${s.value}</p>
    </div>`).join('');

  tableBody.innerHTML = payments.length ? payments.slice(0, 30).map(p => `
    <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <td class="py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-200">${p.payer_name}</td>
      <td class="py-3 px-4 text-sm">${formatMoney(p.amount, p.currency)}</td>
      <td class="py-3 px-4 text-sm">${p.invoices?.invoice_number || '—'}</td>
      <td class="py-3 px-4">${paymentBadge(p.status)}</td>
      <td class="py-3 px-4 text-sm text-slate-400">${timeAgo(p.created_at)}</td>
    </tr>`).join('') : `<tr><td colspan="5" class="py-10 text-center text-slate-400">No transactions yet.</td></tr>`;

  return payments;
}
