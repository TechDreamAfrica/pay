// ============================================================================
// POST /functions/v1/hubtel-check-status
//
// Polled by receipt.html / pay.html while a payment is "processing" —
// browsers can't call Hubtel directly (needs Basic Auth secrets), so this
// thin proxy re-checks status and syncs our `payments` row if it has
// changed since the last webhook (covers missed/delayed webhook deliveries).
//
// Body: { clientReference: string }
// ============================================================================
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { checkTransactionStatus } from '../_shared/hubtel.ts';

const HUBTEL_TO_INTERNAL_STATUS: Record<string, string> = {
  Success: 'successful',
  Paid: 'successful',
  Pending: 'processing',
  Unpaid: 'failed',
  Failed: 'failed',
  Cancelled: 'cancelled',
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { clientReference } = await req.json();
    if (!clientReference) return jsonResponse({ error: 'clientReference is required.' }, 400);

    const supabase = getSupabaseAdmin();
    const { data: payment, error } = await supabase
      .from('payments').select('*').eq('client_reference', clientReference).single();
    if (error || !payment) return jsonResponse({ error: 'Payment not found.' }, 404);

    // Already settled — no need to hit Hubtel again.
    if (['successful', 'failed', 'cancelled', 'refunded'].includes(payment.status)) {
      return jsonResponse({ status: payment.status, payment });
    }

    const hubtelData = await checkTransactionStatus(clientReference);
    const mapped = HUBTEL_TO_INTERNAL_STATUS[hubtelData?.data?.status] ?? 'processing';

    if (mapped !== payment.status) {
      const { data: updated } = await supabase
        .from('payments')
        .update({
          status: mapped,
          hubtel_transaction_id: hubtelData?.data?.transactionId ?? payment.hubtel_transaction_id,
          raw_webhook_payload: hubtelData,
        })
        .eq('id', payment.id)
        .select()
        .single();

      await supabase.from('audit_logs').insert({
        actor: 'system:hubtel-check-status', action: 'payment.status_polled',
        entity_type: 'payment', entity_id: payment.id, metadata: { from: payment.status, to: mapped },
      });

      return jsonResponse({ status: mapped, payment: updated });
    }

    return jsonResponse({ status: payment.status, payment });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Could not check transaction status.' }, 500);
  }
});
